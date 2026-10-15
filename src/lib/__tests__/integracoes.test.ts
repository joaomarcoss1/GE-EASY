import { describe, expect, it } from "vitest";
import { datajudAlias, normalizarDatajud, parseDataDatajud, tipoDoMovimento, dataBrasilia } from "../juridico/datajud";
import { conteudoPublicacao, dataPublicacaoDjen, lerResposta, normalizarData, parseOab, textoPlano } from "../juridico/djen";
import { detectarTipoArquivo } from "../seguranca/arquivos";

describe("DataJud", () => {
  it("identifica o índice do tribunal pelo número CNJ", () => {
    expect(datajudAlias("1000123-45.2024.8.26.0100")).toBe("tjsp");
    expect(datajudAlias("0700001-23.2023.8.07.0001")).toBe("tjdft");
    expect(datajudAlias("0000001-23.2023.5.02.0001")).toBe("trt2");
    expect(datajudAlias("0000001-23.2023.5.00.0000")).toBe("tst");
    expect(datajudAlias("1000001-23.2023.4.01.3400")).toBe("trf1");
    expect(datajudAlias("0600001-23.2024.6.26.0001")).toBe("tre-sp");
    expect(datajudAlias("0000001-23.2023.3.00.0000")).toBe("stj");
    expect(datajudAlias("0000001-23.2023.1.00.0000")).toBeNull();
    expect(datajudAlias("123")).toBeNull();
  });

  it("lê os formatos de data do DataJud", () => {
    expect(parseDataDatajud("2023-05-10T14:32:00.000Z")?.toISOString()).toBe("2023-05-10T14:32:00.000Z");
    expect(parseDataDatajud("2023-05-10T14:32:00")?.toISOString()).toBe("2023-05-10T17:32:00.000Z");
    expect(parseDataDatajud("20180716000000")?.toISOString()).toBe("2018-07-16T03:00:00.000Z");
    expect(parseDataDatajud("lixo")).toBeNull();
    expect(dataBrasilia(new Date("2024-01-02T01:00:00Z"))).toBe("2024-01-01");
  });

  it("classifica movimentos", () => {
    expect(tipoDoMovimento("Juntada de Petição")).toBe("peticao");
    expect(tipoDoMovimento("Julgado procedente o pedido")).toBe("sentenca");
    expect(tipoDoMovimento("Audiência de conciliação designada")).toBe("audiencia");
    expect(tipoDoMovimento("Mero expediente")).toBe("despacho");
    expect(tipoDoMovimento("Remessa")).toBe("outro");
  });

  it("normaliza a resposta juntando graus e sem movimentos duplicados", () => {
    const mov = { codigo: 85, nome: "Petição", dataHora: "2024-02-01T10:00:00.000Z", complementosTabelados: [{ descricao: "tipo_de_peticao", nome: "Contestação" }] };
    const r = normalizarDatajud({
      hits: {
        hits: [
          { _source: { numeroProcesso: "10001234520248260100", grau: "G1", tribunal: "TJSP", classe: { nome: "Procedimento Comum Cível" }, assuntos: [{ nome: "Indenização" }], orgaoJulgador: { nome: "1ª Vara Cível" }, dataAjuizamento: "20240110000000", dataHoraUltimaAtualizacao: "2024-02-02T00:00:00.000Z", movimentos: [mov, mov] } },
          { _source: { numeroProcesso: "10001234520248260100", grau: "G2", assuntos: [[{ nome: "Dano moral" }]], movimentos: [{ codigo: 1, nome: "Acórdão", dataHora: "2024-06-01T12:00:00Z" }] } },
        ],
      },
    });
    expect(r?.classe).toBe("Procedimento Comum Cível");
    expect(r?.orgao).toBe("1ª Vara Cível");
    expect(r?.dataAjuizamento).toBe("2024-01-10");
    expect(r?.assuntos).toEqual(["Indenização", "Dano moral"]);
    expect(r?.graus.sort()).toEqual(["G1", "G2"]);
    expect(r?.movimentos).toHaveLength(2);
    expect(r?.movimentos[0].descricao).toBe("Petição — tipo de peticao: Contestação");
    expect(r?.movimentos[1].tipo).toBe("acordao");
    expect(normalizarDatajud({ hits: { hits: [] } })).toBeNull();
  });
});

describe("DJEN", () => {
  it("lê o número da OAB em vários formatos", () => {
    expect(parseOab("SP 123456")).toEqual({ numero: "123456", uf: "SP" });
    expect(parseOab("123.456/SP")).toEqual({ numero: "123456", uf: "SP" });
    expect(parseOab("OAB/MG 012345")).toEqual({ numero: "12345", uf: "MG" });
    expect(parseOab("SP123456")).toEqual({ numero: "123456", uf: "SP" });
    expect(parseOab("123456")).toBeNull();
    expect(parseOab("")).toBeNull();
  });

  it("calcula a publicação no primeiro dia útil seguinte", () => {
    expect(dataPublicacaoDjen("2025-03-14")).toBe("2025-03-17"); // sexta -> segunda
    expect(dataPublicacaoDjen("2025-04-17")).toBe("2025-04-22"); // 18/04 Sexta-feira Santa, 21/04 Tiradentes
  });

  it("lê a resposta de forma defensiva", () => {
    const { itens, total } = lerResposta({
      count: 2,
      items: [
        { id: 99, hash: "abc", data_disponibilizacao: "2025-03-14", siglaTribunal: "TJSP", nomeOrgao: "1ª Vara", tipoComunicacao: "Intimação", texto: "<p>Fica a parte <b>intimada</b>&nbsp;a se manifestar.</p>", numero_processo: "10001234520248260100", destinatarios: [{ nome: "Fulano" }], link: "https://x.jus.br/a" },
        { id: 100, datadisponibilizacao: "15/03/2025", texto: "abc" },
      ],
    });
    expect(total).toBe(2);
    expect(itens).toHaveLength(1);
    expect(itens[0].texto).toBe("Fica a parte intimada a se manifestar.");
    expect(itens[0].numeroProcesso).toBe("10001234520248260100");
    expect(conteudoPublicacao(itens[0])).toContain("Intimação · 1ª Vara");
    expect(normalizarData("15/03/2025")).toBe("2025-03-15");
    expect(textoPlano("a<br>b")).toBe("a\nb");
  });
});

describe("assinatura de arquivos", () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
  it("confere o conteúdo real com o tipo declarado", () => {
    expect(detectarTipoArquivo(bytes(0x25, 0x50, 0x44, 0x46, 0x2d), "application/pdf")).toBe(true);
    expect(detectarTipoArquivo(bytes(0x89, 0x50, 0x4e, 0x47), "image/png")).toBe(true);
    expect(detectarTipoArquivo(bytes(0xff, 0xd8, 0xff), "image/jpeg")).toBe(true);
    expect(detectarTipoArquivo(bytes(0x50, 0x4b, 0x03, 0x04), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(true);
    expect(detectarTipoArquivo(new TextEncoder().encode("<html><script>alert(1)</script>"), "application/pdf")).toBe(false);
    expect(detectarTipoArquivo(new TextEncoder().encode("nome;valor\nA;1"), "text/csv")).toBe(true);
    expect(detectarTipoArquivo(new TextEncoder().encode("<script>x</script>"), "text/plain")).toBe(false);
  });
});
