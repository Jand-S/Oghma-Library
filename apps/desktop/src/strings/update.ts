/** Atualização do app (updater), pt-BR. */
export const updateStrings = {
  title: "Atualização disponível",
  button: "Atualizar",
  updating: "Atualizando…",
  available: (version: string) => `A versão ${version} do Oghma está disponível`,
  dialogTitle: (version: string) => `Oghma ${version}`,
  dialogHint: "Uma nova versão está pronta. O app baixa, instala e reabre sozinho; sua biblioteca e seus ajustes continuam iguais.",
  notesLabel: "Novidades",
  install: "Atualizar e reiniciar",
  later: "Agora não",
  retry: "Tentar de novo",
  downloading: "Baixando a atualização",
  restarting: "Instalado. Reabrindo o Oghma…",
  failed: "Não foi possível atualizar"
} as const;
