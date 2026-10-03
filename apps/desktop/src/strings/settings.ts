import type { ChapterPreset, IndexMode, SourceSite } from "../core/types";

/** Labels for the settings view ("Ajustes"), pt-BR. */
export const settingsStrings = {
  navLabel: "Categorias de ajustes",
  saved: "Salvo",

  categories: {
    general: "Geral",
    downloads: "Downloads",
    server: "Fontes e servidor",
    kindle: "Kindle e iCloud",
    audio: "Tradução",
    about: "Sobre"
  },
  descriptions: {
    general: "Idioma, tela inicial e aparência do app.",
    downloads: "Onde os livros são salvos e como cada download começa.",
    server: "Servidor de índices, modo de indexação e sincronização das fontes.",
    kindle: "Envio para o Kindle por cabo ou Wi-Fi, e cópia dos livros para o iCloud Drive.",
    audio: "Audiobook gerado a partir do texto (TTS) e atalhos de tradução.",
    about: "Versão, links e configuração inicial."
  },

  groups: {
    locale: { title: "Idioma e início", description: "Como o app fala com você e onde ele abre." },
    appearance: { title: "Aparência", description: "Cores e contraste da interface." },
    folder: { title: "Pasta da biblioteca", description: "Os livros baixados ficam aqui e aparecem na Biblioteca." },
    downloadDefaults: { title: "Padrões do download", description: "O que vem marcado ao baixar um livro novo." },
    queue: { title: "Fila", description: "Como os downloads são processados." },
    server: { title: "Servidor de índices", description: "De onde vêm o catálogo e a lista de fontes." },
    sync: { title: "Sincronização", description: "Mantém os índices das fontes ativas atualizados." },
    kindle: { title: "Envio para o Kindle", description: "Pelo cabo USB (AZW3, com capa) ou por Wi-Fi com o app Send to Kindle (EPUB)." },
    icloud: { title: "iCloud Drive", description: "\"Salvar no iCloud\" copia o EPUB para o iCloud Drive. Ele abre no iPhone e no iPad pelos apps Arquivos e Livros." },
    audiobook: { title: "Audiobook (TTS)", description: "Voz e formato do áudio gerado a partir do texto." },
    translation: { title: "Tradução", description: "Tradução automática dos capítulos baixados." },
    setup: { title: "Configuração inicial", description: "Revise servidor, pasta e fontes com o assistente." }
  },

  // Geral
  language: "Idioma do app",
  languageHint: "Outros idiomas em breve.",
  languagePtBr: "Português (Brasil)",
  startPage: "Tela inicial",
  startPageHint: "A tela aberta quando o app inicia.",
  theme: "Tema",
  themeDark: "Escuro",
  themeHint: "Tema claro em breve.",

  // Downloads
  outputPath: "Pasta de saída",
  outputPathHint: "Cada livro ganha uma subpasta com EPUB, capa e demais formatos.",
  outputPathRequired: "Informe uma pasta para salvar os livros.",
  pickOutputFolder: "Escolher…",
  pickOutputFolderTitle: "Escolha a pasta da biblioteca",
  pickUnavailable: "Disponível no app desktop.",
  openFolder: "Abrir pasta",
  openFolderFailed: "Não foi possível abrir a pasta.",
  pickFolderFailed: "Não foi possível usar essa pasta.",
  outputPathRefused: "Essa pasta não pode ser a pasta de saída.",
  defaultFormats: "Formatos padrão",
  defaultFormatsHint: "Pré-selecionados ao baixar um livro. Pelo menos um formato fica marcado.",
  chapterPreset: "Capítulos por padrão",
  chapterPresetHint: "Escolha inicial na tela do livro; dá para mudar a cada download.",
  chapterPresets: {
    all: "Todos os capítulos",
    range: "Escolher uma faixa"
  } satisfies Record<ChapterPreset, string>,
  queueNoteTitle: "Um download por vez",
  queueNote: "O Oghma baixa um livro de cada vez. Os próximos esperam numa fila curta, que você reordena, pausa ou cancela em Downloads.",
  openDownloads: "Abrir Downloads",

  // Fontes / Servidor
  serverUrl: "Endereço do servidor",
  serverUrlHint: "Endereço que entrega o catálogo e a lista de fontes.",
  serverUrlRequired: "Informe o endereço do servidor.",
  serverUrlInvalid: "Use um endereço completo, começando com http:// ou https://.",
  serverStatus: "Status do servidor",
  serverUnchecked: "Não verificado",
  serverChecking: "Verificando…",
  serverOnline: (latencyMs: number) => `Online · ${latencyMs} ms`,
  serverFailed: "Sem resposta",
  serverDetails: (name: string, version: string, sources: number) =>
    `${name} · versão ${version} · ${sources} ${sources === 1 ? "fonte" : "fontes"}`,
  indexMode: "Modo de indexação",
  indexModeHint: "Como o servidor atualiza os índices das fontes.",
  indexModes: {
    incremental_recent: "Incremental (recomendado)",
    catalog_only: "Somente catálogo",
    guarded_refresh: "Varredura protegida"
  } satisfies Record<IndexMode, string>,
  syncOnLaunch: "Sincronizar ao abrir o app",
  syncOnLaunchHint: "Atualiza os índices das fontes ativas na inicialização.",
  lastSync: "Última sincronização",
  lastSyncNever: "Ainda não sincronizado",
  syncNow: "Sincronizar agora",
  syncDone: "Índices sincronizados.",
  syncFailed: "Não foi possível sincronizar uma ou mais fontes.",
  noEnabledSources: "Nenhuma fonte ativa.",
  enabledSources: (enabled: number, total: number) => `${enabled} de ${total} fontes ativas`,
  manageSources: "Gerenciar fontes",

  // Kindle
  kindleStatus: "Dispositivo",
  kindleConnected: "Conectado",
  kindleConnectedMtp: "Conectado por cabo (MTP)",
  kindleConnectedDisk: "Conectado por cabo (disco)",
  sendToKindleApp: "Send to Kindle",
  sendToKindleAppHint: "App gratuito da Amazon que envia por Wi-Fi para o Kindle e o app Kindle, usando a sua conta.",
  sendToKindleInstalled: "Instalado",
  sendToKindleMissing: "Não instalado",
  sendToKindleDownload: "Baixar",
  kindleMethod: "Método padrão",
  kindleMethodHint: "Já vem escolhido na página Kindle.",
  kindleMethodUsb: "Cabo USB",
  kindleMethodWireless: "Wi-Fi",
  icloudStatus: "iCloud Drive",
  icloudChecking: "Verificando…",
  icloudOn: "Ativado",
  icloudOff: "Desativado",
  icloudOffHint: "Ative em Ajustes do Sistema → Apple ID → iCloud → iCloud Drive.",
  icloudFolder: "Pasta no iCloud Drive",
  icloudFolderHint: (folder: string) => `Os livros vão para iCloud Drive → ${folder.split("/").join(" → ")}.`,
  kindleDisconnected: "Não conectado",
  kindleStatusHint: "Conecte o Kindle no cabo USB para enviar em AZW3.",
  kindleFormat: "Formato de envio",
  kindleFormatAzw3: "AZW3 (recomendado)",
  kindleFormatHint: "O Kindle recebe AZW3. Livros em EPUB são convertidos antes do envio.",
  kindleAlwaysAzw3: "Gerar AZW3 em todo download",
  kindleAlwaysAzw3Hint: "Deixa o livro pronto para o Kindle, sem converter depois. Equivale a marcar AZW3 em Downloads.",
  openKindle: "Abrir Kindle",

  // Áudio / Tradução
  audiobookDefault: "Gerar audiobook por padrão",
  audiobookDefaultHint: "Pré-seleciona o audiobook ao baixar um livro. Leva mais tempo.",
  ttsVoice: "Voz",
  ttsVoices: [
    { value: "pt-BR-Antonio", label: "Antonio (pt-BR)" },
    { value: "pt-BR-Francisca", label: "Francisca (pt-BR)" },
    { value: "en-US-Guy", label: "Guy (en-US)" }
  ],
  ttsSpeed: "Velocidade da fala",
  ttsSpeedValue: (speed: number) => `${speed.toFixed(1).replace(".", ",")}×`,
  audioFormat: "Formato de áudio",
  audioFormats: [
    { value: "M4B", label: "M4B (com capítulos)" },
    { value: "MP3", label: "MP3" },
    { value: "OGG", label: "OGG" }
  ],
  translationTitle: "Motor e idioma de destino",
  openTranslation: "Abrir Tradução",

  // Sobre
  appName: "Oghma Library",
  tagline: "Light novels em EPUB e AZW3, numa biblioteca local que vai com você para o Kindle.",
  version: (version: string) => `Versão ${version}`,
  github: "Repositório no GitHub",
  reportIssue: "Relatar um problema",
  setupWizard: "Assistente de configuração",
  rerunSetup: "Refazer configuração inicial",
  rerunSetupHint: "Abre o assistente de novo. Seus livros e ajustes atuais continuam salvos.",
  rerunSetupConfirmTitle: "Refazer a configuração inicial?",
  rerunSetupConfirmDescription: "O assistente vai abrir por cima do app. Nada é apagado: você só revisa servidor, pasta e fontes.",
  rerunSetupConfirm: "Abrir assistente"
} as const;

export const settingsLinks = {
  repo: "https://github.com/Jand-S/Oghma-Library",
  issues: "https://github.com/Jand-S/Oghma-Library/issues"
} as const;

/** Human label for a source crawl mode. */
export const sourceModeLabels: Record<SourceSite["mode"], string> = {
  static_html: "HTML estático",
  javascript_required: "Requer JavaScript",
  api_available: "API"
};
