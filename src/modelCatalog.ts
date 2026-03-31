export interface ProviderSpec {
  name: string;
  label: string;
  summary: string;
  endpoint: string;
  models: string[];
  helpText: string;
  tokenField: string | null;
}

export type ModelTag = "code" | "reasoning" | "vision";

export interface ModelDescriptor {
  id: string;
  family: string;
  tags: ModelTag[];
}

function includesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

export function getModelFamily(modelId: string) {
  const normalized = modelId.toLowerCase();

  if (includesAny(normalized, ["claude"])) return "Claude";
  if (includesAny(normalized, ["gpt", "o1", "o3", "o4", "codex"])) return "GPT";
  if (includesAny(normalized, ["gemini"])) return "Gemini";
  if (includesAny(normalized, ["grok"])) return "Grok";
  if (includesAny(normalized, ["qwen"])) return "Qwen";
  if (includesAny(normalized, ["llama"])) return "Llama";
  if (includesAny(normalized, ["deepseek"])) return "DeepSeek";
  if (includesAny(normalized, ["mistral", "mixtral", "codestral"])) return "Mistral";
  if (includesAny(normalized, ["cohere", "command-r"])) return "Cohere";
  if (includesAny(normalized, ["phi"])) return "Phi";
  if (includesAny(normalized, ["gemma"])) return "Gemma";
  if (includesAny(normalized, ["glm"])) return "GLM";
  if (includesAny(normalized, ["kimi"])) return "Kimi";
  if (includesAny(normalized, ["minimax"])) return "MiniMax";
  if (includesAny(normalized, ["hermes"])) return "Hermes";
  if (includesAny(normalized, ["nemotron", "nvidia"])) return "Nemotron";
  if (includesAny(normalized, ["venice"])) return "Venice";

  return "Outros";
}

export function getModelTags(modelId: string): ModelTag[] {
  const normalized = modelId.toLowerCase();
  const tags = new Set<ModelTag>();

  if (includesAny(normalized, ["code", "coder", "codex", "codestral"])) {
    tags.add("code");
  }

  if (includesAny(normalized, ["vision", "vl"])) {
    tags.add("vision");
  }

  if (
    includesAny(normalized, [
      "reasoning",
      "thinking",
      "r1",
      "qwq",
      "o1",
      "o3",
      "o4",
      "opus",
      "sonnet",
      "pro",
    ])
  ) {
    tags.add("reasoning");
  }

  return Array.from(tags);
}

export function describeModel(modelId: string): ModelDescriptor {
  return {
    id: modelId,
    family: getModelFamily(modelId),
    tags: getModelTags(modelId),
  };
}

export function getProviderModels(providerName: string): ModelDescriptor[] {
  const provider = getProviderSpec(providerName);
  return provider.models.map(describeModel);
}

export function groupModelsByFamily(models: ModelDescriptor[]) {
  return models.reduce<Record<string, ModelDescriptor[]>>((groups, model) => {
    if (!groups[model.family]) {
      groups[model.family] = [];
    }
    groups[model.family].push(model);
    return groups;
  }, {});
}

export const PROVIDER_SPECS: ProviderSpec[] = [
  {
    name: "copilot",
    label: "GitHub Copilot",
    summary: "prov_copilot_summary",
    endpoint: "api.githubcopilot.com/chat/completions | api.githubcopilot.com/responses",
    models: [
      "claude-opus-4.6",
      "claude-sonnet-4.6",
      "claude-opus-4.5",
      "claude-sonnet-4.5",
      "claude-sonnet-4",
      "claude-haiku-4.5",
      "gemini-2.5-pro",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex",
      "gpt-5.2",
      "gpt-5.2-codex",
      "gpt-5.1",
      "gpt-5.1-codex",
      "gpt-5.1-codex-max",
      "gpt-5-mini",
      "goldeneye-free-auto",
      "gpt-4.1",
      "gpt-4.1-2025-04-14",
      "gpt-4-o-preview",
      "gpt-4o-2024-11-20",
      "gpt-4o-2024-08-06",
      "gpt-4o-2024-05-13",
      "gpt-4o-mini-2024-07-18",
      "gpt-4",
      "gpt-4-0613",
      "gpt-3.5-turbo",
      "gpt-3.5-turbo-0613",
      "grok-code-fast-1",
    ],
    helpText: "prov_copilot_help",
    tokenField: null,
  },
  {
    name: "github",
    label: "GitHub Models",
    summary: "prov_github_summary",
    endpoint: "models.inference.ai.azure.com/chat/completions",
    models: [
      "gpt-4o",
      "gpt-4o-mini",
      "Meta-Llama-3.1-405B-Instruct",
      "Meta-Llama-3.1-8B-Instruct",
      "Codestral-2501",
      "Cohere-command-r-plus-08-2024",
      "Cohere-command-r-08-2024",
      "Phi-4",
    ],
    helpText: "prov_github_help",
    tokenField: "github_token",
  },
  {
    name: "openrouter",
    label: "OpenRouter",
    summary: "prov_openrouter_summary",
    endpoint: "openrouter.ai/api/v1/chat/completions",
    models: [
      "openai/gpt-4o-mini",
      "openai/gpt-4o",
      "anthropic/claude-3.7-sonnet",
      "google/gemini-2.5-pro",
      "google/gemini-2.5-flash",
      "deepseek/deepseek-r1",
      "meta-llama/llama-3.3-70b-instruct",
    ],
    helpText: "prov_openrouter_help",
    tokenField: "openrouter_key",
  },
  {
    name: "groq",
    label: "Groq",
    summary: "prov_groq_summary",
    endpoint: "api.groq.com/openai/v1/chat/completions",
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "deepseek-r1-distill-llama-70b",
      "qwen-qwq-32b",
      "qwen-2.5-coder-32b",
      "gemma2-9b-it",
      "mixtral-8x7b-32768",
    ],
    helpText: "prov_groq_help",
    tokenField: "groq_key",
  },
  {
    name: "venice",
    label: "Venice",
    summary: "prov_venice_summary",
    endpoint: "api.venice.ai/api/v1/chat/completions",
    models: [
      "venice-uncensored",
      "venice-uncensored-role-play",
      "e2ee-venice-uncensored-24b-p",
      "aion-labs.aion-2-0",
      "llama-3.3-70b",
      "llama-3.2-3b",
      "google-gemma-3-27b-it",
      "e2ee-gemma-3-27b-p",
      "zai-org-glm-4.6",
      "zai-org-glm-4.7",
      "zai-org-glm-4.7-flash",
      "zai-org-glm-5",
      "e2ee-glm-4-7-p",
      "e2ee-glm-4-7-flash-p",
      "olafangensan-glm-4.7-flash-heretic",
      "deepseek-v3.2",
      "mistral-small-3-2-24b-instruct",
      "qwen3-235b-a22b-instruct-2507",
      "qwen3-235b-a22b-thinking-2507",
      "qwen3-next-80b",
      "qwen3-coder-480b-a35b-instruct",
      "qwen3-coder-480b-a35b-instruct-turbo",
      "qwen3-5-9b",
      "qwen3-5-35b-a3b",
      "qwen3-5-122b-a10b",
      "e2ee-qwen3-5-122b-a10b",
      "qwen3-30b-a3b-p",
      "qwen3-vl-30b-a3b-p",
      "qwen3-vl-235b-a22b",
      "qwen-2.5-7b",
      "e2ee-qwen-2-5-7b-p",
      "kimi-k2-5",
      "kimi-k2-thinking",
      "minimax-m21",
      "minimax-m25",
      "minimax-m27",
      "hermes-3-llama-3.1-405b",
      "nvidia-nemotron-3-nano-30b-a3b",
      "openai-gpt-oss-120b",
      "e2ee-gpt-oss-120b-p",
      "e2ee-gpt-oss-20b-p",
      "grok-41-fast",
      "grok-4-20-beta",
      "grok-4-20-multi-agent-beta",
      "grok-code-fast-1",
      "gemini-3-flash-preview",
      "gemini-3-1-pro-preview",
      "claude-sonnet-4-5",
      "claude-sonnet-4-6",
      "claude-opus-4-5",
      "claude-opus-4-6",
      "openai-gpt-4o-2024-11-20",
      "openai-gpt-4o-mini-2024-07-18",
      "openai-gpt-52",
      "openai-gpt-52-codex",
      "openai-gpt-53-codex",
      "openai-gpt-54",
      "openai-gpt-54-mini",
      "openai-gpt-54-pro",
      "qwen-2.5-coder-32b",
      "deepseek-r1",
    ],
    helpText: "prov_venice_help",
    tokenField: "venice_key",
  },
  {
    name: "google",
    label: "Gemini",
    summary: "prov_google_summary",
    endpoint: "generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    helpText: "prov_google_help",
    tokenField: "google_key",
  },
  {
    name: "openai",
    label: "OpenAI",
    summary: "prov_openai_summary",
    endpoint: "api.openai.com/v1/chat/completions",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4-turbo", "o3-mini", "gpt-3.5-turbo"],
    helpText: "prov_openai_help",
    tokenField: "openai_key",
  },
  {
    name: "xai",
    label: "xAI",
    summary: "prov_xai_summary",
    endpoint: "api.x.ai/v1/chat/completions",
    models: ["grok-2-latest", "grok-beta", "grok-vision-beta"],
    helpText: "prov_xai_help",
    tokenField: "xai_key",
  },
  {
    name: "custom",
    label: "Custom (OpenAI-compatible)",
    summary: "prov_custom_summary",
    endpoint: "custom",
    models: [],
    helpText: "prov_custom_help",
    tokenField: "custom_api_key",
  },
];

export function getProviderSpec(providerName: string) {
  return PROVIDER_SPECS.find((provider) => provider.name === providerName) ?? PROVIDER_SPECS[0];
}