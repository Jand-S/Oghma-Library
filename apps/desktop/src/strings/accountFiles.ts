/** Imported books kept in the Oghma account (upload, download, quota), pt-BR. */
export const accountFilesStrings = {
  sending: "Enviando…",
  sendingPercent: (percent: number) => `Enviando… ${Math.round(percent)}%`,
  sendingHint: "Guardando este livro na sua conta Oghma.",
  inAccount: "Na conta",
  inAccountHint: "Guardado na sua conta Oghma. Baixe em outro computador quando quiser.",
  notSent: "Não enviado",
  retry: "Tentar de novo",
  retryLabel: (title: string) => `Enviar de novo para a conta: ${title}`,
  localOnly: "Só neste computador",
  localOnlyHint: "Entre na conta Oghma para guardar este livro e baixá-lo em outro computador.",
  shelfHint: "Guardado na sua conta, sem arquivo neste computador. Baixe quando quiser ler.",
  download: "Baixar da conta",
  downloadHint: "Baixa o EPUB guardado na sua conta para este computador.",
  downloading: "Baixando da conta…",
  downloadingPercent: (percent: number) => `Baixando da conta… ${Math.round(percent)}%`,
  downloaded: (title: string) => `“${title}” baixado da conta.`,
  failedDownload: (title: string, reason: string) => `Não foi possível baixar “${title}”: ${reason}`,
  failedUpload: (title: string, reason: string) => `“${title}” não foi para a conta: ${reason}`,
  usageLabel: "Livros importados",
  usageValue: (used: string, quota: string) => `${used} de ${quota}`,
  usageSummary: (used: string, quota: string) => `Livros importados: ${used} de ${quota}`,
  usageFiles: (count: number) => (count === 1 ? "1 arquivo guardado" : `${count.toLocaleString("pt-BR")} arquivos guardados`),
  usageUnavailable: "Não foi possível ver o espaço da conta agora.",
  errors: {
    quota_exceeded: "a conta está sem espaço para livros importados.",
    file_too_large: "o arquivo passa do limite da conta.",
    files_disabled: "o servidor da conta não guarda livros importados.",
    file_not_found: "o livro não está na conta.",
    sha_mismatch: "o arquivo baixado não confere com o original.",
    upload_missing: "o envio não chegou ao servidor.",
    size_mismatch: "o envio chegou incompleto.",
    unauthorized: "entre na conta Oghma de novo."
  } as Record<string, string>,
  genericError: "não foi possível falar com a conta."
};

/** Reader-facing reason for an account-file error code. */
export function accountFileReason(code: string | null | undefined) {
  return (code && accountFilesStrings.errors[code]) || accountFilesStrings.genericError;
}
