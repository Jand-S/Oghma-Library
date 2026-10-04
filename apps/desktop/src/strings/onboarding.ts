/** Labels for the first-run onboarding wizard, pt-BR. */
export const onboardingStrings = {
  /** Step names, in order. The wizard, its controller and the sync hook derive the step count from this list. */
  steps: ["Boas-vindas", "Conta", "Servidor", "Pasta da biblioteca", "Preferências", "Sincronização"],
  dialogLabel: "Configuração inicial",
  stepIndicator: "Etapas da configuração",
  stepOf: (step: number, total: number) => `Passo ${step} de ${total}`,
  close: "Fechar assistente",

  start: "Começar",
  next: "Próximo",
  back: "Voltar",
  finishAndSync: "Concluir e baixar índices",
  enterApp: "Entrar no app",
  retrySync: "Tentar de novo",

  // 1. Boas-vindas
  welcomeTitle: "Bem-vindo ao Oghma Library",
  welcomeLead: "Busque light novels em várias fontes, baixe em EPUB ou AZW3 e mantenha uma biblioteca local pronta para o Kindle.",
  welcomeFeatures: [
    { title: "Busca em várias fontes", text: "Um catálogo único, com filtros por gênero, status e capítulos." },
    { title: "Downloads organizados", text: "Um livro por vez, com fila, capa e formatos padrão." },
    { title: "Pronto para o Kindle", text: "Converte para AZW3 e envia pelo cabo USB." }
  ],
  welcomeHint: "Leva menos de um minuto. Tudo pode ser mudado depois em Ajustes.",

  // 2. Conta (opcional)
  accountTitle: "Já tem uma conta Oghma?",
  accountLead: "Entre para trazer sua biblioteca, notas e status de outro computador. Também dá para criar uma agora ou pular.",
  accountSignIn: "Entrar ou criar conta",
  accountSkip: "Pular por agora",
  accountSignedIn: (name: string) => `Conectado como ${name}`,
  accountSignedInHint: "Sua biblioteca chega assim que os índices forem baixados. Livros que você já tem nesta pasta aparecem como baixados.",
  accountUnavailable: "A conta Oghma funciona no app desktop. Você pode entrar depois em Ajustes > Conta.",
  accountPerks: [
    { title: "Estante em qualquer computador", text: "Seus livros aparecem mesmo sem baixar; baixe quando quiser ler." },
    { title: "Notas e status junto", text: "Lendo, pausado, concluído e as estrelas que você deu." },
    { title: "Perfil com avatar", text: "Um apelido e um avatar para, no futuro, recomendar livros a amigos." }
  ],

  // 3. Servidor
  serverTitle: "Conecte ao servidor de índices",
  serverLead: "Ele entrega o catálogo e a lista de fontes. O endereço padrão já funciona para a maioria das pessoas.",
  serverUrlLabel: "Servidor de índices",
  serverUrlPlaceholder: "https://…",
  validateServer: "Verificar servidor",
  validatingServer: "Verificando…",
  serverVerified: "Servidor verificado",
  serverNeedsCheck: "Verifique o servidor para continuar.",
  serverVersion: "Versão",
  serverLatency: "Latência",
  serverSources: "Fontes",
  sourcesAvailable: (count: number) => `${count} disponíveis`,
  validateFailed: "Não foi possível validar o servidor informado.",

  // 4. Pasta
  folderTitle: "Onde guardar seus livros?",
  folderLead: "Cada livro ganha uma subpasta com o EPUB, a capa e os outros formatos. Essa pasta vira a sua Biblioteca.",
  outputPathLabel: "Pasta da biblioteca",
  outputPathRequired: "Escolha uma pasta para continuar.",
  useDefaultFolder: "Usar pasta padrão",
  defaultFolderHint: (path: string) => `Padrão: ${path}`,

  // 5. Preferências
  preferencesHeading: "Preferências iniciais",
  preferencesLead: "Valem como padrão para cada novo download. Dá para mudar livro a livro.",
  formatsLabel: "Formatos padrão",
  sourcesHeading: "Fontes para indexar",
  sourcesHint: "Escolha pelo menos uma. As outras podem ser ativadas depois em Fontes.",
  sourcesRequired: "Ative pelo menos uma fonte para continuar.",
  librarySources: (names: string) => `Sua biblioteca tem livros de ${names}.`,
  librarySourcesAction: "Ativar todas",
  sourceMeta: (domain: string, count: number) => `${domain} · ${count.toLocaleString("pt-BR")} novels`,
  syncOnLaunch: "Sincronizar índices ao abrir o app",

  // 6. Sincronização
  syncHeading: "Sincronização inicial dos índices",
  syncLead: "Baixando os índices das fontes escolhidas para a busca já funcionar no primeiro uso.",
  syncPreparing: "Preparando sincronização…",
  syncRunning: "Baixando índices das fontes…",
  syncDone: "Tudo pronto",
  syncFailed: "Algumas fontes falharam",
  syncFailedHint: "Você pode tentar de novo agora ou entrar e sincronizar depois em Fontes.",
  syncOverall: "Progresso da sincronização",
  syncSourceProgress: (name: string) => `Sincronização de ${name}`,
  syncStatus: {
    pending: "Aguardando",
    syncing: "Baixando",
    done: "Pronto",
    error: "Falhou"
  },
  syncDetail: {
    queued: "Na fila de sincronização",
    running: "Baixando índices e capítulos conhecidos",
    done: "Índices prontos para a busca",
    failed: "Falha ao sincronizar a fonte."
  },
  summaryHeading: "Resumo da configuração",
  summaryServer: "Servidor",
  summaryFolder: "Pasta",
  summaryFormats: "Formatos",
  summarySources: "Fontes",
  setupSaved: "Configuração inicial salva."
} as const;
