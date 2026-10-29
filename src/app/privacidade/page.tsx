import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";

export const metadata: Metadata = { title: "Privacidade e proteção de dados" };

const SECOES: { titulo: string; itens: string[] }[] = [
  {
    titulo: "1. Quem trata os dados",
    itens: [
      "O escritório usuário do GE EASY é o controlador dos dados pessoais de clientes, partes e colaboradores (Lei 13.709/2018 — LGPD).",
      "O GE EASY é a ferramenta de gestão utilizada pelo escritório; o acesso é restrito a usuários autorizados.",
    ],
  },
  {
    titulo: "2. Quais dados e para quê",
    itens: [
      "Dados cadastrais e de contato de clientes e partes, informações processuais, documentos, agenda, honorários e registros financeiros.",
      "Finalidades: prestação de serviços advocatícios, acompanhamento de processos e prazos, cobrança de honorários e cumprimento de obrigações legais.",
      "Bases legais: execução de contrato (art. 7º, V), exercício regular de direitos em processo (art. 7º, VI), obrigação legal ou regulatória (art. 7º, II) e, para dados sensíveis, art. 11, II, \"d\".",
    ],
  },
  {
    titulo: "3. Fontes públicas e integrações",
    itens: [
      "Movimentações processuais são obtidas na API Pública do DataJud (CNJ) apenas pelo número do processo.",
      "Intimações são obtidas no Diário de Justiça Eletrônico Nacional (DJEN/Comunica PJe) pelo número de OAB dos advogados do escritório.",
      "Quando habilitado pelo escritório, compromissos são enviados ao Google Agenda do responsável e documentos são arquivados no Google Drive do escritório (escopo mínimo: o sistema só acessa os arquivos que ele próprio cria).",
    ],
  },
  {
    titulo: "4. Como protegemos",
    itens: [
      "Controle de acesso por perfil e por departamento aplicado no próprio banco de dados (Row Level Security): cada pessoa vê apenas o que lhe compete.",
      "Criptografia em trânsito (HTTPS/HSTS) e em repouso; tokens de integração criptografados com AES-256-GCM; documentos em armazenamento privado com links temporários de 60 segundos.",
      "Autenticação em dois fatores, bloqueio após tentativas de login sem sucesso, encerramento da sessão por inatividade e verificação do conteúdo real dos arquivos enviados.",
      "Trilha de auditoria de inclusões, alterações, exclusões, downloads, exportações e acessos a processos em segredo de justiça.",
    ],
  },
  {
    titulo: "5. Retenção",
    itens: [
      "Dados de clientes e processos são mantidos enquanto houver relação contratual e pelos prazos legais de guarda e prescrição.",
      "Registros de acesso à aplicação são mantidos por no mínimo 6 meses (Marco Civil da Internet, art. 15). Registros técnicos são eliminados automaticamente após 180 dias.",
    ],
  },
  {
    titulo: "6. Direitos do titular",
    itens: [
      "Confirmação e acesso aos dados, correção, anonimização ou eliminação quando cabível, portabilidade e informações sobre compartilhamento (art. 18).",
      "O escritório pode gerar o relatório dos dados do titular e realizar a anonimização diretamente no sistema. Solicitações devem ser feitas ao escritório controlador.",
    ],
  },
];

export default function PrivacidadePage() {
  return (
    <main className="min-h-screen bg-bg px-4 py-10 text-fg">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <>
            <Image src="/brand/logo-wordmark-dark.png" alt="EASY Gestão Especializada" width={1071} height={308} className="h-12 w-auto dark:hidden" />
            <Image src="/brand/logo-wordmark-transparent.png" alt="EASY Gestão Especializada" width={1071} height={308} className="hidden h-12 w-auto dark:block" />
          </>
          <Link href="/login" className="text-sm font-semibold text-brand-600 hover:underline">
            Entrar
          </Link>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Privacidade e proteção de dados</h1>
        <p className="mt-2 text-sm text-muted">Como o GE EASY trata e protege dados pessoais, em conformidade com a LGPD.</p>
        <div className="mt-8 space-y-7">
          {SECOES.map((s) => (
            <section key={s.titulo} className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
              <h2 className="text-lg font-semibold">{s.titulo}</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
                {s.itens.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="mt-8 text-xs text-muted">Vulnerabilidades de segurança podem ser comunicadas pelo contato indicado em /.well-known/security.txt.</p>
      </div>
    </main>
  );
}
