export interface FocusFileCommand {
  type: 'focus_file';
  data: { path: string };
}

export interface ScopeBoundaryCommand {
  type: 'scope_boundary';
  data: { files: string[]; label?: string };
}

export interface PauseCommand {
  type: 'pause';
}

export interface ResumeCommand {
  type: 'resume';
}

export interface PromptCommand {
  type: 'prompt';
  data: { text: string };
}

export interface CancelCommand {
  type: 'cancel';
}

export interface ApproveCommand {
  type: 'approve';
}

export interface RejectCommand {
  type: 'reject';
}

export interface ToggleDetailCommand {
  type: 'toggle_detail';
}

export interface ToggleExplainCommand {
  type: 'toggle_explain';
}

export interface SetAutoExpandCommand {
  type: 'set_auto_expand';
  data: { enabled: boolean };
}

export interface ClearCommand {
  type: 'clear';
}

export interface SendKeysCommand {
  type: 'send_keys';
  data: { keys: string };
}

export interface SendTextCommand {
  type: 'send_text';
  data: { text: string };
}

export type SteeringCommand =
  | FocusFileCommand
  | ScopeBoundaryCommand
  | PauseCommand
  | ResumeCommand
  | PromptCommand
  | CancelCommand
  | ApproveCommand
  | RejectCommand
  | ToggleDetailCommand
  | ToggleExplainCommand
  | SetAutoExpandCommand
  | ClearCommand
  | SendKeysCommand
  | SendTextCommand;
