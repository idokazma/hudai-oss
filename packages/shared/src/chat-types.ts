export interface ChatMessage {
  id: string;
  sessionId: string;
  timestamp: number;
  role: 'user' | 'advisor' | 'system';
  text: string;
  proactive?: boolean;
  triggeredBy?: string;
  severity?: 'info' | 'warning' | 'critical';
  /** For permission prompts — renders Approve/Reject buttons */
  actionable?: boolean;
  /** For question prompts — renders option buttons + free-text input */
  respondable?: boolean;
  /** Options for question prompts */
  options?: string[];
  /** Whether the interactive element has been resolved (buttons disabled) */
  resolved?: boolean;
  /** Notification sub-type for styling (test results, errors, etc.) */
  notificationType?: 'info' | 'warning' | 'success' | 'error';
}
