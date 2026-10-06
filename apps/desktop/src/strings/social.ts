import type { ActivityKind } from "../services/socialClient";

const plural = (count: number, one: string, many: string) => `${count.toLocaleString("pt-BR")} ${count === 1 ? one : many}`;

export const socialStrings = {
  title: "Amigos",
  tabsLabel: "Seção",
  tabs: { chats: "Conversas", recommendations: "Indicações", friends: "Amigos" },

  // Friends
  addTitle: "Adicionar amigo",
  addHint: "Digite o apelido exato da pessoa. Ela recebe um pedido e decide se aceita.",
  addLabel: "Apelido do amigo",
  addPlaceholder: "@apelido",
  lookup: "Procurar",
  sendRequest: "Enviar pedido",
  requestSent: (nickname: string) => `Pedido enviado para @${nickname}.`,
  nowFriends: (nickname: string) => `Você e @${nickname} agora são amigos.`,
  notFound: "Ninguém com esse apelido. Confira se está escrito exatamente igual.",
  alreadyFriends: "Vocês já são amigos.",
  rateLimited: "Muitos pedidos agora. Tente de novo mais tarde.",
  networkError: "Sem conexão com a conta Oghma. Tente de novo.",
  genericError: "Não deu certo. Tente de novo.",
  incoming: "Pedidos recebidos",
  outgoing: "Pedidos enviados",
  waiting: "Aguardando resposta",
  accept: "Aceitar",
  decline: "Recusar",
  cancelRequest: "Cancelar pedido",
  friendsList: (count: number) => (count ? plural(count, "amigo", "amigos") : "Amigos"),
  noFriendsTitle: "Nenhum amigo ainda",
  noFriendsDescription: "Adicione alguém pelo apelido para indicar leituras e conversar.",
  friendSince: (date: string) => `Amigos desde ${date}`,
  viewProfile: "Ver perfil",
  chat: "Conversar",
  unfriend: "Desfazer amizade",
  unfriendConfirm: (nickname: string) => `Desfazer a amizade com @${nickname}?`,
  unfriendDescription: "Vocês deixam de ver a estante um do outro e a conversa fica fechada. Dá para pedir de novo depois.",
  block: "Bloquear",
  blockConfirm: (nickname: string) => `Bloquear @${nickname}?`,
  blockDescription: "Vocês deixam de ser amigos, a pessoa não consegue achar você pelo apelido nem mandar mensagens.",
  friendMenu: (nickname: string) => `Ações para @${nickname}`,

  // Profile
  back: "Voltar",
  inCommon: (count: number) => (count ? `${plural(count, "obra", "obras")} em comum` : "Nenhuma obra em comum ainda"),
  hiddenLibrary: "Esta pessoa deixou a biblioteca só para ela.",
  emptyLibrary: "A estante está vazia.",
  shelfGroups: {
    reading: "Lendo",
    paused: "Pausados",
    completed: "Concluídos",
    dropped: "Abandonados",
    unread: "Na estante"
  } as Record<string, string>,
  open: "Abrir",
  addToLibrary: "Adicionar à biblioteca",
  inLibrary: "Na sua biblioteca",
  recommend: "Indicar",

  // Conversations
  chatsEmptyTitle: "Nenhuma conversa",
  chatsEmptyDescription: "Abra a conversa pelo perfil de um amigo ou indique um livro.",
  pickChat: "Escolha uma conversa",
  messagePlaceholder: "Mensagem",
  messageLabel: (nickname: string) => `Mensagem para @${nickname}`,
  send: "Enviar",
  attachBook: "Anexar livro",
  loadOlder: "Mensagens anteriores",
  you: "Você",
  unread: (count: number) => plural(count, "mensagem nova", "mensagens novas"),
  bookMessage: "Indicou um livro",
  notFriendsAnymore: "Vocês não são mais amigos; a conversa está fechada.",

  // Recommendations
  recsNew: "Novas",
  recsAll: "Todas",
  recsFilterLabel: "Mostrar",
  recsEmptyTitle: "Nenhuma indicação",
  recsEmptyDescription: "Quando um amigo indicar um livro, ele aparece aqui.",
  recommendedBy: (nickname: string) => `@${nickname} indicou`,
  added: "Adicionada",
  dismissed: "Dispensada",
  dismiss: "Dispensar",

  // Recommend dialog
  recommendTitle: "Indicar a um amigo",
  recommendAction: "Indicar a um amigo…",
  recommendPick: "Para quem",
  recommendNote: "Recado (opcional)",
  recommendNotePlaceholder: "Por que vale a leitura?",
  recommendSend: (count: number) => (count > 1 ? `Indicar para ${count}` : "Indicar"),
  recommendSent: (count: number) => (count > 1 ? `Indicação enviada para ${count} amigos.` : "Indicação enviada."),
  recommendNoFriends: "Adicione um amigo antes de indicar.",
  pickBookTitle: "Anexar livro",
  pickBookSearch: "Buscar na sua biblioteca",

  // Activity
  activityTitle: "Atividade dos amigos",
  fromFriendsTitle: "Indicado por amigos",
  activity: (kind: ActivityKind, rating?: number | null) => {
    switch (kind) {
      case "started": return "começou a ler";
      case "finished": return rating ? `terminou · ${"★".repeat(rating)}` : "terminou";
      case "dropped": return "abandonou";
      case "rated": return `deu ${"★".repeat(rating ?? 0)} para`;
      default: return "adicionou à estante";
    }
  },

  // Privacy (Ajustes › Conta)
  privacyTitle: "Privacidade",
  privacyDescription: "O que seus amigos veem.",
  libraryVisible: "Amigos veem minha biblioteca",
  libraryVisibleHint: "Status, notas e favoritos dos livros. Livros marcados \"Só eu vejo\" ficam de fora.",
  activityVisible: "Mostrar minha atividade",
  activityVisibleHint: "Quando você começa, termina ou dá nota a um livro, seus amigos veem no Início.",
  privateBook: "Só eu vejo",
  privateBookOff: "Mostrar para amigos",
  privateBadge: "Só você vê este livro"
} as const;
