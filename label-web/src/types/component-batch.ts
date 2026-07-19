export interface ComponentBatchListItem {
  id: string;
  name: string;
  targetId: string;
  status: 'draft' | 'printing' | 'done' | 'archived';
  counts: { total: number; rendered: number; printed: number };
  createdAt: string;
  updatedAt: string;
}

export interface ComponentBatchItem {
  id: string;
  idx: number;
  code: string;
  labelId: string | null;
  pngUrl: string | null;
  labelStatus: string | null;
  printCount: number;
  lastPrintedAt: string | null;
  /** 配对的数值+封装标签(批次内独立条目，pair_item_id 关联)，未配对则为 null。
   *  是完整的独立渲染实体，自己的 pngUrl/labelId/打印状态，不是内容占位。
   *  批量打印时若存在配对，会连数值封装标签一起打印。 */
  binding: {
    value: string;
    package: string;
    itemId: string;
    labelId: string | null;
    pngUrl: string | null;
    labelStatus: string | null;
    printCount: number;
    lastPrintedAt: string | null;
  } | null;
}

export interface ComponentBatchDetail {
  id: string;
  name: string;
  targetId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateComponentBatchRequest {
  name: string;
  codes: string[];
  targetId?: string;
}
