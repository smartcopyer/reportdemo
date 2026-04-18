import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Table, Card, Tag, Select, DatePicker, Space, Button, message } from 'antd';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
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

/** 同一指标在同一时间列、不同「粒度」下返回不同数值，切换 日/月/年 时表格会明显变化 */
function unitNoise(metricKey, colKey, periodType) {
    const u = hash32(`${metricKey}|${colKey}|${periodType}`) / 4294967296;
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
    return `${n >= 0 ? '' : ''}${n.toFixed(1)}%`;
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

const COL_CAPS = { day: 45, month: 36, year: 15 };

const PERIOD_LABELS = { day: '按日', month: '按月', year: '按年' };

/** 导出与当前表格一致的数据（含表头说明行） */
function exportFinancialTableXlsx({ periodType, range, timeMeta, dataSource }) {
    const label = PERIOD_LABELS[periodType] ?? periodType;
    const metaRows = [
        ['资金监控宽表'],
        [`统计粒度：${label}`],
        [`区间：${range[0].format('YYYY-MM-DD')} ~ ${range[1].format('YYYY-MM-DD')}`],
        [],
    ];
    const header = ['指标 / 截止日期', ...timeMeta.map((m) => m.title)];
    const body = dataSource.map((row) => {
        const name = row.metric ?? '';
        if (row.isGroup) {
            return [name, ...timeMeta.map(() => '')];
        }
        return [name, ...timeMeta.map((m) => (row[m.key] != null ? String(row[m.key]) : ''))];
    });
    const aoa = [...metaRows, header, ...body];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '资金监控');
    const stamp = `${range[0].format('YYYYMMDD')}_${range[1].format('YYYYMMDD')}`;
    const safeLabel = label.replace(/\s/g, '');
    XLSX.writeFile(wb, `资金监控宽表_${safeLabel}_${stamp}.xlsx`);
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

function cellValue(metricKey, fmt, colKey, periodType) {
    const u = unitNoise(metricKey, colKey, periodType);
    const u2 = unitNoise(metricKey + '2', colKey, periodType);

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
    const [periodType, setPeriodType] = useState('month');
    const [range, setRange] = useState(() => [
        dayjs().subtract(11, 'month').startOf('month'),
        dayjs().endOf('month'),
    ]);

    useEffect(() => {
        const end = dayjs();
        if (periodType === 'day') {
            setRange([end.subtract(29, 'day').startOf('day'), end.endOf('day')]);
        } else if (periodType === 'month') {
            setRange([end.subtract(11, 'month').startOf('month'), end.endOf('month')]);
        } else {
            setRange([end.subtract(4, 'year').startOf('year'), end.endOf('year')]);
        }
    }, [periodType]);

    const timeMeta = useMemo(
        () => buildTimeColumns(periodType, range[0], range[1]),
        [periodType, range],
    );

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

    const columns = useMemo(() => {
        const first = {
            title: '指标 / 截止日期',
            dataIndex: 'metric',
            key: 'metric',
            fixed: 'left',
            width: 260,
            render: (text, record) => {
                if (record.isGroup) {
                    return <span style={{ fontWeight: 'bold', color: '#333' }}>{text}</span>;
                }
                return (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{text}</span>
                        <span style={{ color: '#999', fontSize: '10px' }}>📊</span>
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

        return [first, ...rest];
    }, [timeMeta, periodType, renderValue]);

    const dataSource = useMemo(() => {
        return METRIC_TEMPLATE.map((row) => {
            if (row.isGroup) {
                return { key: row.key, metric: row.metric, isGroup: true };
            }
            const cells = {};
            for (const meta of timeMeta) {
                cells[meta.key] = cellValue(row.key, row.fmt, meta.key, periodType);
            }
            return {
                key: row.key,
                metric: row.metric,
                ...cells,
            };
        });
    }, [timeMeta, periodType]);

    const picker = periodType === 'day' ? 'date' : periodType === 'month' ? 'month' : 'year';

    const rangePlaceholder =
        periodType === 'day'
            ? ['开始日期', '结束日期']
            : periodType === 'month'
              ? ['开始月份', '结束月份']
              : ['开始年份', '结束年份'];

    const handleExportExcel = useCallback(() => {
        if (!range[0] || !range[1] || !range[0].isValid() || !range[1].isValid()) {
            message.warning('请先选择有效日期区间');
            return;
        }
        try {
            exportFinancialTableXlsx({ periodType, range, timeMeta, dataSource });
            message.success('已开始下载 Excel');
        } catch (e) {
            console.error(e);
            message.error('导出失败，请重试');
        }
    }, [periodType, range, timeMeta, dataSource]);

    return (
        <Card
            className="financial-card report-fullscreen"
            title="资金监控宽表 (多月度对比分析)"
            extra={<Tag color="blue">模拟数据 · 随粒度变化</Tag>}
        >
            <div style={{ marginBottom: 16 }}>
                <Space wrap>
                    <Select
                        value={periodType}
                        style={{ width: 100 }}
                        onChange={setPeriodType}
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
                    <Button type="primary" onClick={() => message.success('已按当前区间展示（模拟数据）')}>
                        查询
                    </Button>
                    <Button onClick={handleExportExcel}>导出Excel</Button>
                </Space>
            </div>

            <Table
                columns={columns}
                dataSource={dataSource}
                pagination={false}
                bordered
                size="small"
                scroll={{ x: 'max-content', y: 'calc(100vh - 220px)' }}
                rowClassName={(record) => (record.isGroup ? 'group-row' : 'data-row')}
            />
        </Card>
    );
};

export default FinancialBroadTable;
