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
  /** 该 code 绑定的数值+封装(component_bindings 表)，未绑定则为 null。
   *  批量打印时若存在绑定，会连数值封装标签一起打印。 */
  binding: { value: string; package: string } | null;
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
