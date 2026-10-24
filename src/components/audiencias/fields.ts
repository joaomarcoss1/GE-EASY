import type { FieldDef, Values } from "@/components/ui/form";
import { AUDIENCIA_MODALIDADES, AUDIENCIA_TIPOS, type Option, type Tone } from "@/lib/constants";

export interface AudienciaItem {
  id: string;
  processo_id: string;
  processo_titulo: string | null;
  processo_cnj: string | null;
  tipo: string;
  data_hora: string;
  /** Data/hora locais (Brasília) */
  date: string;
  time: string;
  endTime: string;
  duracao_min: number;
  modalidade: "presencial" | "virtual" | "hibrida";
  local: string | null;
  link: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  responsavel_avatar: string | null;
  preposto: string | null;
  status: "agendada" | "realizada" | "redesignada" | "cancelada";
  resultado: string | null;
  departamento_nome: string | null;
  departamento_cor: Tone | null;
  sincronizada: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

const DURACOES: Option[] = [15, 30, 45, 60, 90, 120, 180, 240, 300, 360].map((m) => ({
  value: String(m),
  label: m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m / 60}h`,
}));

export function audienciaFields(o: { processos?: Option[] | null; juridico: Option[] }): FieldDef[] {
  return [
    ...(o.processos
      ? [{ name: "processo_id", label: "Processo", type: "select", options: o.processos, required: true, emptyOption: "Selecione o processo…", span: 6, section: "Audiência" } as FieldDef]
      : []),
    { name: "tipo", label: "Tipo", type: "select", options: AUDIENCIA_TIPOS, emptyOption: false, span: 3, section: o.processos ? undefined : "Audiência" },
    { name: "modalidade", label: "Modalidade", type: "select", options: AUDIENCIA_MODALIDADES, emptyOption: false, span: 3 },
    { name: "data_hora", label: "Data e hora", type: "datetime-local", required: true, span: 3, help: "Horário de Brasília" },
    { name: "duracao_min", label: "Duração prevista", type: "select", options: DURACOES, emptyOption: false, span: 3 },
    { name: "local", label: "Local", placeholder: "Fórum, vara, sala…", span: 6, section: "Onde" },
    { name: "link", label: "Link da sala virtual", type: "url", placeholder: "https://…", span: 6, help: "Teams, Zoom, Google Meet, Cisco Webex…" },
    { name: "responsavel_id", label: "Advogado responsável", type: "select", options: o.juridico, emptyOption: "Eu mesmo", span: 3, section: "Equipe" },
    { name: "preposto", label: "Preposto / testemunhas", placeholder: "Nome do preposto", span: 3 },
  ];
}

export const redesignarFields: FieldDef[] = [
  { name: "data_hora", label: "Nova data e hora", type: "datetime-local", required: true, span: 3, help: "Horário de Brasília" },
  { name: "duracao_min", label: "Duração prevista", type: "select", options: DURACOES, emptyOption: false, span: 3 },
  { name: "modalidade", label: "Modalidade", type: "select", options: AUDIENCIA_MODALIDADES, emptyOption: false, span: 6 },
  { name: "local", label: "Local", placeholder: "Fórum, vara, sala…", span: 6 },
  { name: "link", label: "Link da sala virtual", type: "url", placeholder: "https://…", span: 6 },
];

export const audienciaDefaults = (extra?: Values): Values => ({ tipo: "conciliacao", modalidade: "presencial", duracao_min: "60", ...extra });

export function audienciaValues(a: AudienciaItem): Values {
  return {
    processo_id: a.processo_id,
    tipo: a.tipo,
    modalidade: a.modalidade,
    data_hora: `${a.date}T${a.time}`,
    duracao_min: String(a.duracao_min),
    local: a.local,
    link: a.link,
    responsavel_id: a.responsavel_id,
    preposto: a.preposto,
  };
}
