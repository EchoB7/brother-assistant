export interface FileAttachment {
  name: string;
  path: string;
  type: "file" | "image";
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  attachments?: FileAttachment[];
}

export interface Conversation {
  name: string;
  messages: Message[];
}

export interface CopilotAccountSummary {
  username: string;
  added_at: number;
  requests: number;
  total_tokens: number;
  active: boolean;
}

export interface ProviderAccountSummary {
  name: string;
  api_key: string;
  base_url: string;
  added_at: number;
  requests: number;
  total_tokens: number;
  active: boolean;
}

export interface SettingsState {
  agent_mode: boolean;
  provider: string;
  model: string;
  github_token: string;
  openai_key: string;
  openrouter_key: string;
  groq_key: string;
  venice_key: string;
  google_key: string;
  xai_key: string;
  custom_api_url: string;
  custom_api_key: string;
  active_copilot_account: string | null;
  copilot_accounts: CopilotAccountSummary[];
  provider_accounts: Record<string, ProviderAccountSummary[]>;
}

export interface DeviceFlowStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
}
