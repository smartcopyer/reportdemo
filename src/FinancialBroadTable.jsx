import React, { useMemo, useState, useCallback } from 'react';
import {
    Table,
    Card,
    Tag,
    Select,
    DatePicker,
    Space,
    Button,
    message,
    Segmented,
    TreeSelect,
} from 'antd';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import {
    GROUP_ID,
    GROUP_DISPLAY_NAME,
    buildTreeSelectData,
    getChildren,
    getNode,
    listAllCompanies,
} from './companyHierarchy';
import './FinancialReport.css';

const { RangePicker } = DatePicker;

/** 简单字符串哈希，用于稳定可复现的模拟数值 */
function hash32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function parseNumericDisplay(s) {
    if (s == null || s === '') return NaN;
    const t = String(s).replace(/,/g, '').replace('%', '').trim();
    return parseFloat(t);
}

function unitNoise(metricKey, colKey, periodType, companyId = GROUP_ID) {
    const u = hash32(`${metricKey}|${colKey}|${periodType}|${companyId}`) / 4294967296;
    return u;
}

function formatAmount(u) {
    const n = 2000 + u * 8000;
    return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatFlow(u) {
    const n = -800 + u * 2300;
    return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent0_100(u) {
    return `${Math.round(u * 100)}%`;
}

function formatPercentRate(u) {
    const n = 3.2 + u * 2.3;
    return `${n.toFixed(2)}%`;
}

function formatRatio(u) {
    const n = 0.85 + u * 1.35;
    return n.toFixed(2);
}

function formatDeviation(u) {
    const n = -4 + u * 8;
    return `${n.toFixed(1)}%`;
}

/** 指标行定义：分组 + 更多明细行 */
const METRIC_TEMPLATE = [
    { key: 'g1', metric: '资金存量 (万元)', isGroup: true },
    { key: 'm1', metric: '月末现金及等价物', fmt: 'amount' },
    { key: 'm2', metric: '日均余额', fmt: 'amount' },
    { key: 'm3', metric: '受限资金', fmt: 'amount_small' },
    { key: 'm4', metric: '在途资金', fmt: 'amount' },
    { key: 'm5', metric: '理财与结构性存款', fmt: 'amount' },
    { key: 'm6', metric: '可动用资金占比', fmt: 'pct' },

    { key: 'g2', metric: '现金流净额', isGroup: true },
    { key: 'm7', metric: '经营活动净流量', fmt: 'flow' },
    { key: 'm8', metric: '投资活动净流量', fmt: 'flow' },
    { key: 'm9', metric: '筹资活动净流量', fmt: 'flow' },
    { key: 'm10', metric: '自由现金流 (FCF)', fmt: 'flow' },
    { key: 'm11', metric: '现金及等价物净增加', fmt: 'flow' },

    { key: 'g3', metric: '融资负债', isGroup: true },
    { key: 'm12', metric: '有息负债余额', fmt: 'amount' },
    { key: 'm13', metric: '短期有息负债', fmt: 'amount' },
    { key: 'm14', metric: '长期有息负债', fmt: 'amount' },
    { key: 'm15', metric: '综合融资成本', fmt: 'rate' },
    { key: 'm16', metric: '授信使用率', fmt: 'pct' },
    { key: 'm17', metric: '资产负债率', fmt: 'pct' },

    { key: 'g4', metric: '预算执行与风险', isGroup: true },
    { key: 'm18', metric: '资金计划偏差率', fmt: 'deviation' },
    { key: 'm19', metric: '流动比率', fmt: 'ratio' },
    { key: 'm20', metric: '速动比率', fmt: 'ratio' },
    { key: 'm21', metric: '利息保障倍数', fmt: 'ratio' },
];

/** 多公司并排对比：行=公司，列=指标（不含分组行） */
const COMPARE_METRICS = METRIC_TEMPLATE.filter((r) => !r.isGroup);

const COL_CAPS = { day: 45, month: 36, year: 15 };

const PERIOD_LABELS = { day: '按日', month: '按月', year: '按年' };

function exportFinancialTableXlsx({
    periodType,
    range,
    timeMeta,
    dataSource,
    extraMetaLines = [],
    sheetName = '资金监控',
    filePrefix = '资金监控宽表',
}) {
    const label = PERIOD_LABELS[periodType] ?? periodType;
    const metaRows = [['资金监控宽表'], ...extraMetaLines, [`统计粒度：${label}`], [`区间：${range[0].format('YYYY-MM-DD')} ~ ${range[1].format('YYYY-MM-DD')}`], []];
    const header = ['名称', '指标', ...timeMeta.map((m) => m.title)];
    const body = dataSource.map((row) => {
        const metric = row.metric ?? '';
        if (row.isGroup) {
            return ['', metric, ...timeMeta.map(() => '')];
        }
        const entity = row.entityName != null ? String(row.entityName) : '';
        return [entity, metric, ...timeMeta.map((m) => (row[m.key] != null ? String(row[m.key]) : ''))];
    });
    const aoa = [...metaRows, header, ...body];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    const stamp = `${range[0].format('YYYYMMDD')}_${range[1].format('YYYYMMDD')}`;
    const safeLabel = label.replace(/\s/g, '');
    XLSX.writeFile(wb, `${filePrefix}_${safeLabel}_${stamp}.xlsx`);
}

/** 导出用：树形行深度优先拍平（支持集团→公司→企业 三层） */
function flattenMergeRowsForExport(rows) {
    const out = [];
    function walk(r) {
        const { children, ...rest } = r;
        out.push(rest);
        if (children?.length) {
            for (const ch of children) {
                walk(ch);
            }
        }
    }
    for (const row of rows) {
        walk(row);
    }
    return out;
}

function exportCompareTableXlsx({ compareMonth, compareIds, rows, extraMetaLines = [] }) {
    const monthLabel = compareMonth.format('YYYY年MM月');
    const names = compareIds.map((id) => getNode(id)?.name ?? id).join('、');
    const metaRows = [
        ['多公司并排对比'],
        ...extraMetaLines,
        [`对比月份：${monthLabel}`],
        [`对比主体：${names}`],
        [],
    ];
    const header = ['公司名称', ...COMPARE_METRICS.map((m) => m.metric)];
    const body = rows.map((row) => [
        row.companyName ?? '',
        ...COMPARE_METRICS.map((m) => (row[m.key] != null ? String(row[m.key]) : '')),
    ]);
    const aoa = [...metaRows, header, ...body];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '并排对比');
    const stamp = compareMonth.format('YYYYMM');
    XLSX.writeFile(wb, `资金监控_多公司对比_${stamp}.xlsx`);
}

function buildTimeColumns(periodType, start, end) {
    if (!start || !end || !start.isValid() || !end.isValid()) return [];

    let a = start;
    let b = end;
    if (a.isAfter(b)) [a, b] = [b, a];

    const cap = COL_CAPS[periodType] ?? 24;
    const keys = [];

    if (periodType === 'day') {
        let cur = a.startOf('day');
        const last = b.startOf('day');
        while (cur.isBefore(last) || cur.isSame(last)) {
            keys.push({
                key: cur.format('YYYY-MM-DD'),
                label: cur.format('MM-DD'),
                title: cur.format('YYYY-MM-DD'),
                isYearEnd: cur.month() === 11 && cur.date() === 31,
            });
            cur = cur.add(1, 'day');
            if (keys.length >= cap) break;
        }
    } else if (periodType === 'month') {
        let cur = a.startOf('month');
        const last = b.startOf('month');
        while (cur.isBefore(last) || cur.isSame(last)) {
            keys.push({
                key: cur.format('YYYY-MM'),
                label: cur.format('YYYY-MM'),
                title: cur.endOf('month').format('YYYY-MM-DD'),
                isYearEnd: cur.month() === 11,
            });
            cur = cur.add(1, 'month');
            if (keys.length >= cap) break;
        }
    } else {
        let cur = a.startOf('year');
        const last = b.startOf('year');
        while (cur.isBefore(last) || cur.isSame(last)) {
            keys.push({
                key: cur.format('YYYY'),
                label: cur.format('YYYY年'),
                title: cur.format('YYYY-12-31'),
                isYearEnd: true,
            });
            cur = cur.add(1, 'year');
            if (keys.length >= cap) break;
        }
    }

    return keys;
}

function cellValue(metricKey, fmt, colKey, periodType, companyId = GROUP_ID) {
    const u = unitNoise(metricKey, colKey, periodType, companyId);
    const u2 = unitNoise(`${metricKey}2`, colKey, periodType, companyId);

    switch (fmt) {
        case 'amount':
            return formatAmount(u);
        case 'amount_small': {
            const n = 80 + u * 420;
            return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        case 'flow':
            return formatFlow(u);
        case 'pct':
            return formatPercent0_100(u);
        case 'rate':
            return formatPercentRate(u);
        case 'ratio':
            return formatRatio((u + u2) * 0.5);
        case 'deviation':
            return formatDeviation(u);
        default:
            return '—';
    }
}

const FinancialBroadTable = () => {
    const [analysisMode, setAnalysisMode] = useState('merge');
    const [selectedCompanyId, setSelectedCompanyId] = useState(GROUP_ID);
    const mergeTableKey = `merge-${selectedCompanyId}-${analysisMode}`;
    const [compareIds, setCompareIds] = useState(['c-east', 'c-north', 'e-sh']);
    const [compareMonth, setCompareMonth] = useState(() => dayjs().subtract(1, 'month').startOf('month'));

    const [periodType, setPeriodType] = useState('month');
    const [range, setRange] = useState(() => [
        dayjs().subtract(11, 'month').startOf('month'),
        dayjs().endOf('month'),
    ]);

    const handlePeriodTypeChange = useCallback((v) => {
        setPeriodType(v);
        const end = dayjs();
        if (v === 'day') {
            setRange([end.subtract(29, 'day').startOf('day'), end.endOf('day')]);
        } else if (v === 'month') {
            setRange([end.subtract(11, 'month').startOf('month'), end.endOf('month')]);
        } else {
            setRange([end.subtract(4, 'year').startOf('year'), end.endOf('year')]);
        }
    }, []);

    const timeMeta = useMemo(
        () => buildTimeColumns(periodType, range[0], range[1]),
        [periodType, range],
    );

    const treeData = useMemo(() => buildTreeSelectData(), []);

    const renderValue = useCallback(
        (value, record) => {
            if (record.isGroup) {
                return { props: { style: { background: '#f5f5f5' } }, children: '' };
            }
            const num = parseNumericDisplay(value);
            const color = !Number.isNaN(num) && num < 0 ? '#cf1322' : '#333';
            return <span style={{ color, fontFamily: 'Arial' }}>{value}</span>;
        },
        [],
    );

    const mergeColumns = useMemo(() => {
        const nameCol = {
            title: '名称',
            dataIndex: 'entityName',
            key: 'entityName',
            fixed: 'left',
            width: 130,
            render: (text, record) => {
                if (record.isGroup) return '';
                const lv = record.drillLevel ?? 0;
                if (lv === 0) return <span className="entity-name-level-0">{text}</span>;
                if (lv === 1) return <span className="entity-name-level-1">{text}</span>;
                return <span className="entity-name-level-2">{text}</span>;
            },
        };

        const metricCol = {
            title: '指标',
            dataIndex: 'metric',
            key: 'metric',
            fixed: 'left',
            width: 260,
            render: (text, record) => {
                if (record.isGroup) {
                    return <span style={{ fontWeight: 'bold', color: '#333' }}>{text}</span>;
                }
                return (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <span>{text}</span>
                        {(record.drillLevel ?? 0) === 0 ? (
                            <span style={{ color: '#999', fontSize: '10px' }}>📊</span>
                        ) : null}
                    </div>
                );
            },
        };

        const rest = timeMeta.map((meta) => ({
            title: meta.title,
            dataIndex: meta.key,
            key: meta.key,
            width: periodType === 'year' ? 100 : 110,
            align: 'right',
            className: meta.isYearEnd ? 'year-end' : undefined,
            render: renderValue,
        }));

        return [nameCol, metricCol, ...rest];
    }, [timeMeta, periodType, renderValue]);

    const mergeDataSource = useMemo(() => {
        const cellsFor = (tpl, entityId) => {
            const cells = {};
            for (const meta of timeMeta) {
                cells[meta.key] = cellValue(tpl.key, tpl.fmt, meta.key, periodType, entityId);
            }
            return cells;
        };

        /**
         * 集团合并口径：一层=集团数据 → 展开二层=各公司 → 再展开三层=各企业
         * 选二级公司口径：一层=该公司 → 展开二层=旗下企业
         * 选三级叶子：仅一层，无展开
         */
        return METRIC_TEMPLATE.map((row) => {
            if (row.isGroup) {
                return { key: row.key, entityName: '', metric: row.metric, isGroup: true };
            }

            if (selectedCompanyId === GROUP_ID) {
                const companies = getChildren(GROUP_ID);
                const base = {
                    key: row.key,
                    entityName: GROUP_DISPLAY_NAME,
                    metric: row.metric,
                    fmt: row.fmt,
                    isGroup: false,
                    drillLevel: 0,
                    ...cellsFor(row, GROUP_ID),
                };
                if (!companies.length) return base;

                base.children = companies.map((co) => {
                    const enterprises = getChildren(co.id);
                    const coRow = {
                        key: `${row.key}__${co.id}`,
                        entityName: co.name,
                        metric: row.metric,
                        drillLevel: 1,
                        ...cellsFor(row, co.id),
                    };
                    if (!enterprises.length) return coRow;
                    coRow.children = enterprises.map((en) => ({
                        key: `${row.key}__${co.id}__${en.id}`,
                        entityName: en.name,
                        metric: row.metric,
                        drillLevel: 2,
                        ...cellsFor(row, en.id),
                    }));
                    return coRow;
                });
                return base;
            }

            const next = getChildren(selectedCompanyId);
            if (next.length > 0) {
                return {
                    key: row.key,
                    entityName: getNode(selectedCompanyId)?.name ?? '',
                    metric: row.metric,
                    fmt: row.fmt,
                    isGroup: false,
                    drillLevel: 0,
                    ...cellsFor(row, selectedCompanyId),
                    children: next.map((en) => ({
                        key: `${row.key}__${en.id}`,
                        entityName: en.name,
                        metric: row.metric,
                        drillLevel: 1,
                        ...cellsFor(row, en.id),
                    })),
                };
            }

            return {
                key: row.key,
                entityName: getNode(selectedCompanyId)?.name ?? '',
                metric: row.metric,
                fmt: row.fmt,
                isGroup: false,
                drillLevel: 0,
                ...cellsFor(row, selectedCompanyId),
            };
        });
    }, [timeMeta, periodType, selectedCompanyId]);

    const mergeExportFlat = useMemo(
        () => flattenMergeRowsForExport(mergeDataSource),
        [mergeDataSource],
    );

    const compareColumns = useMemo(() => {
        const first = {
            title: '公司名称',
            dataIndex: 'companyName',
            key: 'companyName',
            fixed: 'left',
            width: 168,
            ellipsis: true,
        };
        const rest = COMPARE_METRICS.map((m) => ({
            title: m.metric,
            dataIndex: m.key,
            key: m.key,
            width: 128,
            align: 'right',
            ellipsis: true,
            render: renderValue,
        }));
        return [first, ...rest];
    }, [renderValue]);

    const compareDataSource = useMemo(() => {
        const mk = compareMonth.format('YYYY-MM');
        return compareIds.map((cid) => {
            const node = getNode(cid);
            const row = {
                key: `compare_row_${cid}`,
                companyName: node?.name ?? cid,
            };
            for (const m of COMPARE_METRICS) {
                row[m.key] = cellValue(m.key, m.fmt, mk, 'month', cid);
            }
            return row;
        });
    }, [compareIds, compareMonth]);

    const picker = periodType === 'day' ? 'date' : periodType === 'month' ? 'month' : 'year';

    const rangePlaceholder =
        periodType === 'day'
            ? ['开始日期', '结束日期']
            : periodType === 'month'
              ? ['开始月份', '结束月份']
              : ['开始年份', '结束年份'];

    const handleExportExcel = useCallback(() => {
        try {
            if (analysisMode === 'compare') {
                if (!compareIds.length) {
                    message.warning('请至少选择一家公司进行对比');
                    return;
                }
                exportCompareTableXlsx({
                    compareMonth,
                    compareIds,
                    rows: compareDataSource,
                });
            } else {
                if (!range[0] || !range[1] || !range[0].isValid() || !range[1].isValid()) {
                    message.warning('请先选择有效日期区间');
                    return;
                }
                const entity = getNode(selectedCompanyId);
                exportFinancialTableXlsx({
                    periodType,
                    range,
                    timeMeta,
                    dataSource: mergeExportFlat,
                    extraMetaLines: [[`统计口径：${entity?.name ?? '—'}（${entity?.id === GROUP_ID ? '集团合并' : '单体/合并下级视图'}）`], ['分析模式：默认视图 + 指标下钻（子行已展开导出）']],
                });
            }
            message.success('已开始下载 Excel');
        } catch (e) {
            console.error(e);
            message.error('导出失败，请重试');
        }
    }, [
        analysisMode,
        range,
        periodType,
        timeMeta,
        mergeExportFlat,
        compareDataSource,
        compareMonth,
        compareIds,
        selectedCompanyId,
    ]);

    return (
        <Card
            className="financial-card report-fullscreen"
            title={
                <Space wrap size="small">
                    <span>资金监控宽表</span>
                    <Tag color={analysisMode === 'merge' ? 'blue' : 'geekblue'}>
                        {analysisMode === 'merge' ? '默认视图' : '多公司并排对比'}
                    </Tag>
                </Space>
            }
        >
            <div className="report-toolbar">
                <Space wrap size={[12, 8]} align="center">
                    <Segmented
                        value={analysisMode}
                        onChange={setAnalysisMode}
                        options={[
                            { label: '默认视图', value: 'merge' },
                            { label: '多公司并排对比', value: 'compare' },
                        ]}
                    />

                    {analysisMode === 'merge' ? (
                        <>
                            <span className="report-toolbar-label">统计口径</span>
                            <TreeSelect
                                className="company-tree-select"
                                value={selectedCompanyId}
                                treeData={treeData}
                                onChange={(v) => setSelectedCompanyId(v)}
                                treeDefaultExpandAll
                                showSearch
                                treeNodeFilterProp="title"
                                placeholder="选择公司主体"
                                style={{ minWidth: 220 }}
                            />
                        </>
                    ) : (
                        <>
                            <span className="report-toolbar-label">对比月份</span>
                            <DatePicker
                                picker="month"
                                value={compareMonth}
                                onChange={(d) => d && setCompareMonth(d.startOf('month'))}
                                allowClear={false}
                            />
                            <span className="report-toolbar-label">选择公司</span>
                            <Select
                                mode="multiple"
                                className="compare-company-select"
                                value={compareIds}
                                onChange={(ids) => setCompareIds(ids.slice(0, 8))}
                                options={listAllCompanies().map((c) => ({
                                    label: c.name,
                                    value: c.id,
                                }))}
                                placeholder="选择 2～8 家公司"
                                maxTagCount="responsive"
                                style={{ minWidth: 320 }}
                            />
                        </>
                    )}
                </Space>

                <Space wrap className="report-toolbar-row2">
                    {analysisMode === 'merge' && (
                        <>
                            <Select
                                value={periodType}
                                style={{ width: 100 }}
                                onChange={handlePeriodTypeChange}
                                options={[
                                    { value: 'day', label: '按日' },
                                    { value: 'month', label: '按月' },
                                    { value: 'year', label: '按年' },
                                ]}
                            />
                            <RangePicker
                                picker={picker}
                                value={range}
                                onChange={(vals) => vals && vals[0] && vals[1] && setRange(vals)}
                                placeholder={rangePlaceholder}
                                allowClear={false}
                            />
                        </>
                    )}
                    <Button type="primary" onClick={() => message.success('已按当前条件展示（模拟数据）')}>
                        查询
                    </Button>
                    <Button onClick={handleExportExcel}>导出Excel</Button>
                </Space>
            </div>

            {analysisMode === 'merge' ? (
                <Table
                    key={mergeTableKey}
                    className="report-main-table report-tree-table"
                    columns={mergeColumns}
                    dataSource={mergeDataSource}
                    pagination={false}
                    bordered
                    size="small"
                    scroll={{ x: 'max-content', y: 'calc(100vh - 280px)' }}
                    rowClassName={(record) => {
                        if (record.isGroup) return 'group-row';
                        const lv = record.drillLevel ?? 0;
                        if (lv === 2) return 'data-row drill-row-l2';
                        if (lv === 1) return 'data-row drill-row-l1';
                        return 'data-row';
                    }}
                    expandable={{
                        indentSize: 12,
                        expandIconColumnIndex: 1,
                    }}
                />
            ) : (
                <Table
                    className="report-main-table"
                    columns={compareColumns}
                    dataSource={compareDataSource}
                    pagination={false}
                    bordered
                    size="small"
                    scroll={{ x: 'max-content', y: 'calc(100vh - 280px)' }}
                    rowClassName={() => 'data-row'}
                />
            )}
        </Card>
    );
};

export default FinancialBroadTable;
