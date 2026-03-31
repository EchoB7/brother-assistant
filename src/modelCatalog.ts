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
    summary: "Usa suas contas Copilot autenticadas e já cobre chat, respostas e rotação de contas.",
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
    helpText: "Usa contas GitHub autenticadas por Device Flow. Suporta múltiplas contas e rotação automática em 429.",
    tokenField: null,
  },
  {
    name: "github",
    label: "GitHub Models",
    summary: "Usa token do GitHub para acessar o catálogo do GitHub Models fora do fluxo do Copilot.",
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
    helpText: "Use um token do GitHub para GitHub Models.",
    tokenField: "github_token",
  },
  {
    name: "openrouter",
    label: "OpenRouter",
    summary: "Gateway com vários modelos e vários vendors em uma única API.",
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
    helpText: "Use sua API key do OpenRouter.",
    tokenField: "openrouter_key",
  },
  {
    name: "groq",
    label: "Groq",
    summary: "Baixa latência para modelos compatíveis com OpenAI.",
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
    helpText: "Use sua API key da Groq.",
    tokenField: "groq_key",
  },
  {
    name: "venice",
    label: "Venice",
    summary: "Catálogo amplo da Venice. Neste app, a integração atual cobre chat/texto; imagem, áudio e vídeo ainda não estão ligados na UI.",
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
    helpText: "Use sua API key da Venice. A Venice tem mais de 100 modelos no catálogo geral; neste cliente, a lista acima foi ampliada para chat/texto. Endpoints de image generation, TTS e vídeo da Venice ainda precisam de integração própria no app.",
    tokenField: "venice_key",
  },
  {
    name: "google",
    label: "Gemini",
    summary: "Usa chaves do Google AI Studio para modelos Gemini.",
    endpoint: "generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    helpText: "Use sua API key do Google AI Studio para Gemini.",
    tokenField: "google_key",
  },
  {
    name: "openai",
    label: "OpenAI",
    summary: "API oficial da OpenAI para modelos GPT e o-series.",
    endpoint: "api.openai.com/v1/chat/completions",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4-turbo", "o3-mini", "gpt-3.5-turbo"],
    helpText: "Use sua API key da OpenAI.",
    tokenField: "openai_key",
  },
  {
    name: "xai",
    label: "xAI",
    summary: "API da xAI para modelos Grok.",
    endpoint: "api.x.ai/v1/chat/completions",
    models: ["grok-2-latest", "grok-beta", "grok-vision-beta"],
    helpText: "Use sua API key da xAI.",
    tokenField: "xai_key",
  },
  {
    name: "custom",
    label: "Custom (OpenAI-compatible)",
    summary: "Endpoint próprio compatível com OpenAI, como Ollama ou LM Studio.",
    endpoint: "custom",
    models: [],
    helpText: "Qualquer API compatível com OpenAI (Ollama, LM Studio, etc).",
    tokenField: "custom_api_key",
  },
];

export function getProviderSpec(providerName: string) {
  return PROVIDER_SPECS.find((provider) => provider.name === providerName) ?? PROVIDER_SPECS[0];
}