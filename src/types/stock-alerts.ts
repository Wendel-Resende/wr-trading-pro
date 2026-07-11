export interface StockAlert {
  id: string;
  stockId: string;
  stock?: {
    id: string;
    asset?: {
      symbol: string;
      name: string;
    };
  };
  type: 'PRICE' | 'DIVIDEND' | 'STATUS' | 'PORTFOLIO';
  condition: 'above' | 'below' | 'equals' | 'changed_to';
  value?: number;
  targetValue?: number;
  message: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  isActive: boolean;
  isRead: boolean;
  triggeredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface StockAlertInput {
  stockId: string;
  type: 'PRICE' | 'DIVIDEND' | 'STATUS' | 'PORTFOLIO';
  condition: 'above' | 'below' | 'equals' | 'changed_to';
  value?: number;
  targetValue?: number;
  message: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
}

export interface StockAlertUpdate {
  isActive?: boolean;
  isRead?: boolean;
  triggeredAt?: Date;
}

export interface StockAlertSummary {
  total: number;
  unread: number;
  critical: number;
  warning: number;
  info: number;
  recent: StockAlert[];
}
