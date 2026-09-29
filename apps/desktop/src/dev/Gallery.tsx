/**
 * Dev-only primitive gallery: open the app with `?gallery` in `npm run dev`.
 * main.tsx imports this lazily behind `import.meta.env.DEV`, so it is not in production builds.
 */
import { Download, Heart, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { BottomPanel, PageHeader, SplashScreen } from "../shell";
import {
  Badge,
  Button,
  CheckboxField,
  Chip,
  ConfirmationModal,
  Cover,
  DropdownMenu,
  EmptyState,
  IconButton,
  Modal,
  Panel,
  ProgressBar,
  Section,
  SegmentedControl,
  SelectField,
  Skeleton,
  SortableList,
  Spinner,
  Switch,
  TextField,
  ToastProvider,
  useContextMenu,
  useToast,
  type ButtonVariant,
  type MenuItem
} from "../ui";
import "./Gallery.css";

const variants: ButtonVariant[] = ["primary", "outline", "ghost", "danger", "glass"];

function Row({ children }: { children: ReactNode }) {
  return <div className="gallery-row">{children}</div>;
}

function ToastDemo() {
  const { toast } = useToast();
  return (
    <Row>
      <Button onClick={() => toast({ message: "Livro adicionado à fila.", tone: "info" })}>Info</Button>
      <Button onClick={() => toast({ message: "Download concluído.", tone: "success" })}>Success</Button>
      <Button onClick={() => toast({ message: "Kindle quase cheio.", tone: "warning", duration: 8000 })}>Warning</Button>
      <Button onClick={() => toast({ message: "Não foi possível baixar.", tone: "danger", action: { label: "Tentar de novo", onClick: () => undefined } })}>
        Danger + ação
      </Button>
    </Row>
  );
}

function GalleryContent() {
  const [modalOpen, setModalOpen] = useState(false);
  const [nestedOpen, setNestedOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [switchOn, setSwitchOn] = useState(true);
  const [segment, setSegment] = useState<"grid" | "list" | "compact">("grid");
  const [chips, setChips] = useState<string[]>(["Fantasia"]);
  const [queue, setQueue] = useState([
    { id: "a", title: "The Enchanted Forest" },
    { id: "b", title: "Whispers of the Night" },
    { id: "c", title: "The Labyrinth's Secret" }
  ]);
  const context = useContextMenu();
  const menuItems: MenuItem[] = [
    { label: "Editar", icon: <Pencil />, onSelect: () => undefined },
    { label: "Favoritar", icon: <Heart />, onSelect: () => undefined },
    { label: "Desativado", onSelect: () => undefined, disabled: true },
    { label: "Excluir", icon: <Trash2 />, onSelect: () => undefined, danger: true, separatorBefore: true }
  ];

  return (
    <div className="gallery">
      <PageHeader title="Galeria de primitivas" actions={<Badge tone="accent">DEV</Badge>} search={<TextField label="Buscar" hideLabel placeholder="Buscar…" leading={<Search />} />} />
      <div className="gallery-body">
        <Section title="Button" description="variant × size, com ícone e loading">
          {(["sm", "md", "lg"] as const).map((size) => (
            <Row key={size}>
              {variants.map((variant) => (
                <Button key={variant} variant={variant} size={size} icon={<Download />}>{variant}</Button>
              ))}
              <Button size={size} loading>Carregando</Button>
              <Button size={size} disabled>Desativado</Button>
            </Row>
          ))}
        </Section>

        <Section title="IconButton">
          <Row>
            {variants.map((variant) => <IconButton key={variant} label={variant} icon={<Plus />} variant={variant} />)}
            <IconButton label="Pequeno" icon={<Plus />} size="sm" />
            <IconButton label="Grande" icon={<Plus />} size="lg" />
            <IconButton label="Carregando" icon={<Plus />} loading />
            <Spinner label="Carregando" />
          </Row>
        </Section>

        <Section title="Campos">
          <div className="gallery-grid">
            <TextField label="Servidor" placeholder="https://" hint="Endereço do índice" />
            <TextField label="Pasta" defaultValue="/tmp" error="Pasta não encontrada" />
            <SelectField label="Fonte" options={[{ value: "a", label: "Central Novel" }, { value: "b", label: "Novel Mania" }]} hint="Fonte ativa" />
            <CheckboxField label="Gerar audiobook" description="Usa o TTS local" defaultChecked />
            <Switch label="Baixar capas" description="Salva cover.jpg na pasta" checked={switchOn} onChange={setSwitchOn} />
            <SegmentedControl
              aria-label="Visualização"
              value={segment}
              onChange={setSegment}
              options={[{ value: "grid", label: "Grade" }, { value: "list", label: "Lista" }, { value: "compact", label: "Compacta" }]}
            />
          </div>
        </Section>

        <Section title="Chip e Badge">
          <Row>
            {["Fantasia", "Romance", "Isekai"].map((tag) => (
              <Chip
                key={tag}
                selected={chips.includes(tag)}
                onToggle={() => setChips((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])}
              >
                {tag}
              </Chip>
            ))}
            <Chip onRemove={() => undefined}>Removível</Chip>
            <Chip tone="accent">accent</Chip>
            <Chip tone="danger">danger</Chip>
            <Chip tone="warning">warning</Chip>
            <Chip tone="success">success</Chip>
          </Row>
          <Row>
            {(["neutral", "accent", "success", "warning", "danger"] as const).map((tone) => <Badge key={tone} tone={tone}>{tone}</Badge>)}
          </Row>
        </Section>

        <Section title="ProgressBar e Skeleton">
          <div className="gallery-stack">
            <ProgressBar label="Download" value={42} />
            <ProgressBar label="Download" value={80} size="sm" tone="success" />
            <ProgressBar label="Download" value={30} tone="danger" />
            <ProgressBar label="Preparando" indeterminate />
            <Skeleton height={16} width="60%" />
            <Skeleton height={120} width={80} radius={6} />
          </div>
        </Section>

        <Section title="Cover">
          <Row>
            <Cover title="The Enchanted Forest" size="sm" />
            <Cover title="The Enchanted Forest" />
            <Cover title="Whispers" size="lg" sheen src="/icons/oghma-icon.svg" />
            <Cover title="Quebrada" src="/nao-existe.png" />
          </Row>
        </Section>

        <Section title="Modal, ConfirmationModal e DropdownMenu">
          <Row>
            <Button variant="primary" onClick={() => setModalOpen(true)}>Abrir modal</Button>
            <Button variant="danger" onClick={() => setConfirmOpen(true)}>Excluir…</Button>
            <DropdownMenu label="Ações" align="end" trigger={<IconButton label="Mais ações" icon={<MoreHorizontal />} variant="outline" />} items={menuItems} />
            <DropdownMenu label="Ações" trigger={<Button>Menu</Button>} items={menuItems} />
            <div className="gallery-context" onContextMenu={context.onContextMenu}>Clique com o botão direito</div>
            <DropdownMenu label="Contexto" items={menuItems} open={context.open} position={context.position} onClose={context.onClose} />
          </Row>
          <Modal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            title="Converter downloads"
            description="Formatos já existentes são ignorados."
            footer={<><Button variant="ghost" onClick={() => setModalOpen(false)}>Cancelar</Button><Button variant="primary" onClick={() => setNestedOpen(true)}>Abrir outro</Button></>}
          >
            <TextField label="Nome" />
            <p>Esc fecha só o modal de cima.</p>
          </Modal>
          <Modal open={nestedOpen} onClose={() => setNestedOpen(false)} title="Modal aninhado" size="sm">
            <Button onClick={() => setNestedOpen(false)}>Fechar</Button>
          </Modal>
          <ConfirmationModal
            open={confirmOpen}
            onClose={() => setConfirmOpen(false)}
            onConfirm={() => setConfirmOpen(false)}
            title="Excluir 2 livros?"
            description="Os arquivos locais também serão apagados."
            confirmLabel="Excluir"
            tone="danger"
          />
        </Section>

        <Section title="Toast">
          <ToastDemo />
        </Section>

        <Section title="SortableList" description="Arraste pela alça ou use Alt + ↑/↓">
          <SortableList
            aria-label="Fila de download"
            items={queue}
            getId={(item) => item.id}
            getLabel={(item) => item.title}
            onReorder={setQueue}
            renderItem={(item, { handleProps, index }) => (
              <div className="gallery-queue-item">
                <SortableList.Handle {...handleProps} />
                <Cover title={item.title} size="sm" />
                <span>{index + 1}. {item.title}</span>
              </div>
            )}
          />
        </Section>

        <Section title="Panel e EmptyState">
          <div className="gallery-grid">
            <Panel title="Painel" description="Superfície padrão" actions={<Button size="sm">Ação</Button>}>
              <p>Conteúdo do painel.</p>
            </Panel>
            <Panel title="Vidro" glass>
              <p>Painel com glass.</p>
            </Panel>
          </div>
          <EmptyState icon={<Download />} title="Nenhum download" description="Escolha um livro em Buscar." action={<Button variant="primary">Buscar</Button>} />
        </Section>

        <Section title="Shell">
          <div className="gallery-shell-sample">
            <BottomPanel active={{ title: "The Enchanted Forest", progress: 42, speedBps: 1_250_000, etaSec: 35 }} queuedCount={2} kindle={{ connected: true, deviceName: "Kindle" }} onOpenDownloads={() => undefined} />
            <BottomPanel active={null} queuedCount={0} kindle={null} onOpenDownloads={() => undefined} />
          </div>
          <div className="gallery-splash">
            <SplashScreen steps={[{ id: "a", label: "Lendo configurações", status: "done" }, { id: "b", label: "Conectando ao servidor de índice", status: "active" }, { id: "c", label: "Carregando catálogo", status: "pending" }]} />
          </div>
        </Section>
      </div>
    </div>
  );
}

export function Gallery() {
  return (
    <ToastProvider>
      <GalleryContent />
    </ToastProvider>
  );
}
