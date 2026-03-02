export interface InsightSummary {
  text: string;
  generatedAt: number;
  eventWindow: [number, number];
}

export interface InsightIntent {
  text: string;
  confidence: 'high' | 'medium' | 'low';
  detectedAt: number;
}

export interface InsightNotification {
  id: string;
  text: string;
  severity: 'info' | 'warning' | 'critical';
  triggeredBy: string;
  timestamp: number;
}
