/** Ajustes > Conta and the account menu (pt-BR). */
export const accountStrings = {
  category: "Conta",
  categoryDescription: "Sua conta do ChatGPT, usada na tradução e nas sugestões da busca.",
  usedFor: "A conta do ChatGPT é usada na Tradução e em “Pedir sugestões à IA”, no Buscar. Os tokens ficam só no app.",
  unavailable: "Disponível no app desktop.",
  loading: "Verificando a conta…",
  plan: (plan: string) => `Plano ChatGPT ${plan.charAt(0).toUpperCase()}${plan.slice(1)}`,
  usage5h: "Uso pelo app nas últimas 5h",
  usageValue: (words: string, credits: string) => `${words} palavras · ~${credits} créditos`,
  usageValueLong: (words: string, credits: string) => `Últimas 5h: ${words} palavras (~${credits} créditos)`,
  usageWeek: (words: string, credits: string) => `Na semana: ${words} palavras (~${credits} créditos)`,
  open: "Abrir",
  openSettings: "Ajustes da conta",
  menuLabel: (email?: string) => (email ? `Conta ChatGPT: ${email}` : "Conta ChatGPT"),
  connectBannerTitle: "Conecte sua conta do ChatGPT",
  connectBannerText: "A tradução usa a sua assinatura do ChatGPT. Você vê os projetos, mas precisa conectar para traduzir."
} as const;
