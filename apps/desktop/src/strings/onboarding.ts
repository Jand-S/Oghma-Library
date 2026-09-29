/** Labels for the first-run onboarding wizard, pt-BR. */
export const onboardingStrings = {
  steps: ["Bem-vindo", "Servidor", "Saída", "Fontes", "Preferências", "Resumo", "Sincronização"],
  next: "Próximo",
  back: "Voltar",
  finishAndSync: "Concluir e baixar índices",
  enterApp: "Entrar no app",
  serverUrlLabel: "Servidor de index",
  validateServer: "Verificar servidor",
  validatingServer: "Validando...",
  sourcesAvailable: (count: number) => `${count} disponíveis`,
  outputPathLabel: "Pasta local de saída",
  sourcesHeading: "Selecione as fontes para indexar",
  preferencesHeading: "Preferências iniciais",
  summaryHeading: "Resumo da configuração",
  syncHeading: "Sincronização inicial dos índices"
} as const;
