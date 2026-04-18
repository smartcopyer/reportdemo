/** 模拟组织架构：三层 — 集团合并 → 二级公司 → 三级企业 */

export const GROUP_ID = 'group';

/** 统计口径为集团时，主行「名称」列展示用 */
export const GROUP_DISPLAY_NAME = '集团合并';

export const COMPANY_NODES = [
    { id: 'group', name: '集团合并', parentId: null, short: '集团' },
    { id: 'c-east', name: '华东产业公司', parentId: 'group', short: '华东' },
    { id: 'c-north', name: '华北产业公司', parentId: 'group', short: '华北' },
    { id: 'c-south', name: '华南产业公司', parentId: 'group', short: '华南' },
    { id: 'e-sh', name: '上海实业', parentId: 'c-east', short: '上海实业' },
    { id: 'e-hz', name: '杭州制造', parentId: 'c-east', short: '杭州制造' },
    { id: 'e-nj', name: '南京商贸', parentId: 'c-east', short: '南京商贸' },
    { id: 'e-bj', name: '北京运营中心', parentId: 'c-north', short: '北京运营' },
    { id: 'e-tj', name: '天津物流', parentId: 'c-north', short: '天津物流' },
    { id: 'e-sz', name: '深圳科技', parentId: 'c-south', short: '深圳科技' },
    { id: 'e-gz', name: '广州服务', parentId: 'c-south', short: '广州服务' },
];

export function getNode(id) {
    return COMPANY_NODES.find((n) => n.id === id) ?? null;
}

export function getChildren(parentId) {
    return COMPANY_NODES.filter((n) => n.parentId === parentId);
}

export function hasChildren(id) {
    return getChildren(id).length > 0;
}

/** TreeSelect / 展示用 */
export function buildTreeSelectData() {
    const build = (parentId) => {
        const list = getChildren(parentId);
        if (!list.length) return undefined;
        return list.map((n) => ({
            title: n.name,
            value: n.id,
            children: build(n.id),
        }));
    };
    const root = getNode(GROUP_ID);
    return [
        {
            title: root.name,
            value: root.id,
            children: build(GROUP_ID),
        },
    ];
}

/** 多选对比：全部可选主体（含集团） */
export function listAllCompanies() {
    return [...COMPANY_NODES];
}
