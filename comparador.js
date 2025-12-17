/* ---------------------------
   LEITOR XML (NF)
---------------------------- */

function parseXML(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = e => {
      const parser = new DOMParser();
      const xml = parser.parseFromString(e.target.result, "application/xml");
      const get = tag => (xml.getElementsByTagName(tag)[0] && xml.getElementsByTagName(tag)[0].textContent) ? xml.getElementsByTagName(tag)[0].textContent.trim() : "";

      const nNF = get("nNF");
      const pesoL = get("pesoL");
      const pesoB = get("pesoB");
      // Prioriza placa da carreta/trailer quando disponível
      let placa = "";
      // Se existirem múltiplas tags <placa>, a segunda costuma ser a da carreta
      const placas = xml.getElementsByTagName('placa');
      if (placas && placas.length > 1) {
        placa = placas[1] && placas[1].textContent ? placas[1].textContent.trim() : "";
      } else {
        placa = get("placa");
      }

      // Se ainda não achou, procura tags/elementos que contenham 'carreta', 'reboque' ou 'trailer'
      if (!placa) {
        const keywords = ['carreta', 'reboque', 'trailer', 'reboques', 'carroceria'];
        const all = xml.getElementsByTagName('*');
        for (let i = 0; i < all.length && !placa; i++) {
          const ln = all[i].localName ? all[i].localName.toLowerCase() : '';
          if (keywords.some(k => ln.includes(k))) {
            // procurar texto com formato de placa dentro do elemento
            const text = all[i].textContent || '';
            const m = text.match(/[A-Z]{3}-?\d[A-Z0-9]{3}/i);
            if (m) placa = m[0].toUpperCase();
          }
        }
      }

        if (!placa) {
        const infCpl = get("infCpl") || "";
        // procura primeiro por rótulos explícitos como 'Carreta' ou 'Reboque'
        let m = infCpl.match(/Carreta[:\s]*([A-Z]{3}-?\d[A-Z0-9]{3}(?:\/[A-Z]{2})?)/i);
            if (m && m[1]) {
              placa = m[1].toUpperCase();
            } else {
              m = infCpl.match(/Reboque[:\s]*([A-Z]{3}-?\d[A-Z0-9]{3}(?:\/[A-Z]{2})?)/i);
              if (m && m[1]) placa = m[1].toUpperCase();
              else {
                // fallback: pega a última placa encontrada no texto (veículo geralmente aparece antes da carreta)
                const all = infCpl.match(/[A-Z]{3}-?\d[A-Z0-9]{3}(?:\/[A-Z]{2})?/gi);
                if (all && all.length) placa = all[all.length - 1].toUpperCase();
              }
            }
        }

      resolve({ nNF, pesoL, pesoB, placa });
    };
    reader.readAsText(file);
  });
}

/* ---------------------------
   FUNÇÃO DE VALIDADE POR CÓDIGO
---------------------------- */

function validadePorCodigo(codigo, dataProducao) {
  codigo = Number(codigo);

  const prazos = {
    180: [223, 201],
    7:   [104, 120],
    15:  [106, 122],
    60:  [250, 290],
    365: [300, 304, 305, 306, 307, 308]
  };

  let dias = 0;

  for (const prazo in prazos) {
    if (prazos[prazo].includes(codigo)) {
      dias = Number(prazo);
      break;
    }
  }

  if (!dias || !dataProducao) return "";

  const [dia, mes, ano] = dataProducao.split("/").map(Number);
  const d = new Date(ano, mes - 1, dia);
  d.setDate(d.getDate() + dias);

  return d.toLocaleDateString("pt-BR");
}

/* ---------------------------
   LEITOR CSV (LAUDO)
---------------------------- */

function parseCSV(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = e => {
      const texto = e.target.result;
      const linhas = texto.split(/\r?\n/);

      let nota = "", placa = "", data = "", codigoProd = "";

      linhas.forEach(l => {
        if (/nota/i.test(l)) {
          const m = l.match(/\d{4,}/);
          if (m) nota = m[0];
        }

        if (/placa/i.test(l)) {
          const m = l.match(/[A-Z]{3}-?\d[A-Z0-9]{3}/i);
          if (m) placa = m[0].toUpperCase();
        }

        if (/produto/i.test(l)) {
          const partes = l.split(";");
          const valor = partes.find(p => /^\d+$/.test(p.trim()));
          if (valor) codigoProd = valor.trim();
        }

        const dataEncontrada = l.match(/(\d{2}\/\d{2}\/\d{4})/);
        if (dataEncontrada && !data) {
          data = dataEncontrada[0];
        }
      });

      const validade = validadePorCodigo(codigoProd, data);

      resolve({ nota, placa, data, codigoProd, validade });
    };
    reader.readAsText(file, "UTF-8");
  });
}

/* ---------------------------
   NORMALIZAÇÕES
---------------------------- */

function normalizaPeso(valor) {
  if (!valor) return 0;

  valor = valor.trim().replace(",", ".");
  let numero = parseFloat(valor);
  if (isNaN(numero)) return 0;

  if (numero < 100) numero *= 1000; // ton → kg

  return Number(numero.toFixed(3));
}

function normalizaPlaca(p) {
  return p ? p.replace("-", "").toUpperCase().trim() : "";
}

function normalizaNota(n) {
  return n ? n.replace(/^0+/, "") : "";
}

/* ---------------------------
   COMPARAÇÃO
---------------------------- */
/* ---------------------------
   COMPARAÇÃO (VERSÃO OTIMIZADA)
---------------------------- */

(() => {
  // Pequenas utilitárias
  const safeText = (node) => (node && node.textContent) ? node.textContent.trim() : "";

  const findTagText = (xmlDoc, tag) => {
    // procura por tag diretamente, se não achar tenta por localName (namespaces)
    const byName = xmlDoc.getElementsByTagName(tag);
    if (byName && byName.length) return safeText(byName[0]);
    const all = xmlDoc.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      if (all[i].localName && all[i].localName.toLowerCase() === tag.toLowerCase()) return safeText(all[i]);
    }
    return "";
  };

  const floatEq = (a, b, eps = 0.001) => Math.abs(Number(a || 0) - Number(b || 0)) <= eps;

  function parseXML(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve({ nNF: "", pesoL: "", pesoB: "", placa: "" });
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const parser = new DOMParser();
          const xml = parser.parseFromString(e.target.result, "application/xml");
          const nNF = findTagText(xml, 'nNF') || findTagText(xml, 'NFNumero') || findTagText(xml, 'numero');
          const pesoL = findTagText(xml, 'pesoL') || findTagText(xml, 'pesoLiquido') || '';
          const pesoB = findTagText(xml, 'pesoB') || findTagText(xml, 'pesoBruto') || '';
          // Extrai lacres
          let lacres = findTagText(xml, 'infCpl') || '';
          const lacresMatch = lacres.match(/Lacres?:\s*([0-9-]+)/i);
          lacres = lacresMatch ? lacresMatch[1].trim() : '';
          // Extrai preferencialmente a placa da carreta/trailer
          let placa = '';
          const placas = xml.getElementsByTagName('placa');
          if (placas && placas.length > 1) {
            placa = placas[1] && placas[1].textContent ? placas[1].textContent.trim() : '';
          } else {
            placa = findTagText(xml, 'placa');
          }
          if (!placa) {
            const keywords = ['carreta', 'reboque', 'trailer', 'reboques', 'carroceria'];
            const all = xml.getElementsByTagName('*');
            for (let i = 0; i < all.length && !placa; i++) {
              const ln = all[i].localName ? all[i].localName.toLowerCase() : '';
              if (keywords.some(k => ln.includes(k))) {
                const text = all[i].textContent || '';
                const m = text.match(/[A-Z]{3}-?\d[A-Z0-9]{3}/i);
                if (m) placa = m[0].toUpperCase();
              }
            }
          }
          if (!placa) {
            const infCpl = findTagText(xml, 'infCpl') || '';
            // procura rótulos explícitos primeiro
            let m = infCpl.match(/Carreta[:\s]*([A-Z]{3}-?\d[A-Z0-9]{3}(?:\/[A-Z]{2})?)/i);
            if (m && m[1]) placa = m[1].toUpperCase();
            else {
              m = infCpl.match(/Reboque[:\s]*([A-Z]{3}-?\d[A-Z0-9]{3}(?:\/[A-Z]{2})?)/i);
              if (m && m[1]) placa = m[1].toUpperCase();
              else {
                const all = infCpl.match(/[A-Z]{3}-?\d[A-Z0-9]{3}(?:\/[A-Z]{2})?/gi);
                if (all && all.length) placa = all[all.length - 1].toUpperCase();
              }
            }
          }
          resolve({ nNF, pesoL, pesoB, placa, lacres });
        } catch (err) {
          resolve({ nNF: "", pesoL: "", pesoB: "", placa: "", lacres: "" });
        }
      };
      reader.onerror = () => resolve({ nNF: "", pesoL: "", pesoB: "", placa: "", lacres: "" });
      reader.readAsText(file);
    });
  }

  function validadePorCodigo(codigo, dataProducao) {
    codigo = Number(codigo);
    const prazos = {
      180: [223, 201],
      7:   [104, 120],
      15:  [106, 122],
      60:  [250, 290],
      365: [300, 304, 305, 306, 307, 308]
    };
    let dias = 0;
    for (const p in prazos) if (prazos[p].includes(codigo)) { dias = Number(p); break; }
    if (!dias || !dataProducao) return "";
    const parts = dataProducao.split('/').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return "";
    const [dia, mes, ano] = parts;
    const d = new Date(ano, mes - 1, dia);
    d.setDate(d.getDate() + dias);
    return d.toLocaleDateString('pt-BR');
  }

  function parseCSV(file) {
    return new Promise((resolve) => {
      if (!file) return resolve({ nota: '', placa: '', data: '', codigoProd: '', validade: '', lacres: '' });
      const reader = new FileReader();
      reader.onload = e => {
        const texto = e.target.result.replace(/\r/g, '');
        const linhas = texto.split('\n');
        let nota = '', placa = '', data = '', codigoProd = '', lacres = '';
        for (let i = 0; i < linhas.length; i++) {
          const l = linhas[i].trim();
          if (!l) continue;
          if (!nota) {
            const m = l.match(/\d{4,}/);
            if (m) nota = m[0];
          }
          if (!placa) {
            const m = l.match(/[A-Z]{3}-?\d[A-Z0-9]{3}/i);
            if (m) placa = m[0].toUpperCase();
          }
          if (!codigoProd && /produto/i.test(l)) {
            const partes = l.split(/[,;\t]/).map(s => s.trim());
            const valor = partes.find(p => /^\d+$/.test(p));
            if (valor) codigoProd = valor;
          }
          if (!data) {
            const d = l.match(/(\d{2}\/\d{2}\/\d{4})/);
            if (d) data = d[0];
          }
          if (!lacres && /lacres?/i.test(l)) {
            const m = l.match(/Lacres?:\s*([0-9-]+)/i);
            if (m) lacres = m[1].trim();
          }
        }
        const validade = validadePorCodigo(codigoProd, data);
        resolve({ nota, placa, data, codigoProd, validade, lacres });
      };
      reader.onerror = () => resolve({ nota: '', placa: '', data: '', codigoProd: '', validade: '' });
      reader.readAsText(file, 'UTF-8');
    });
  }

  function normalizaPeso(valor) {
    if (!valor && valor !== 0) return 0;
    let s = String(valor).trim().toLowerCase();
    // remove unidades conhecidas
    s = s.replace(/kg/gi, '').replace(/kilo/gi, '').replace(/t\b|tonelada|ton/gi, '');
    s = s.replace(',', '.');
    const n = parseFloat(s);
    if (isNaN(n)) return 0;
    // se aparentemente for em toneladas (valor pequeno), converte para kg
    const numero = n < 100 ? n * 1000 : n;
    return Number(numero.toFixed(3));
  }

  function normalizaPlaca(p) {
    if (!p) return '';
    // remove sufixo de estado como '/SP' antes de normalizar
    const stripState = (s) => String(s).replace(/\/\s*[A-Z]{2}$/i, '').trim();
    p = stripState(p);
    // remove traços e qualquer caracter não alfanumérico, retorna sem '-'
    return String(p).replace(/[^A-Z0-9]/gi, '').toUpperCase().trim();
  }

  function normalizaNota(n) {
    if (!n && n !== 0) return '';
    return String(n).replace(/^0+/, '').trim();
  }

  async function compararFiles(fileXml1, fileXml2, fileCsv) {
    const [nf1, nf2, laudo] = await Promise.all([
      parseXML(fileXml1),
      parseXML(fileXml2),
      parseCSV(fileCsv)
    ]);

    const pesoL1 = normalizaPeso(nf1.pesoL);
    const pesoL2 = normalizaPeso(nf2.pesoL);
    const pesoB1 = normalizaPeso(nf1.pesoB);
    const pesoB2 = normalizaPeso(nf2.pesoB);

    // Normaliza placas: remove sufixo /UF e formata
    nf1.placa = normalizaPlaca(nf1.placa);
    nf2.placa = normalizaPlaca(nf2.placa);
    laudo.placa = normalizaPlaca(laudo.placa);

    const NA = 'N/A';
    const lacresMatch = ((nf1.lacres === laudo.lacres || nf2.lacres === laudo.lacres) && laudo.lacres) ? 'ok' : (laudo.lacres ? 'erro' : 'N/A');
    
    const linhas = [
      // Nota 2 deve aparecer como N/A conforme solicitado
      ['Nota Fiscal', nf1.nNF || NA, NA, laudo.nota || NA, (normalizaNota(nf1.nNF) === normalizaNota(laudo.nota)) ? 'ok' : 'erro', ''],
      ['Peso Líquido (kg)', pesoL1 || NA, pesoL2 || NA, NA, floatEq(pesoL1, pesoL2) ? 'ok' : 'erro', ''],
      ['Peso Bruto (kg)', pesoB1 || NA, pesoB2 || NA, NA, floatEq(pesoB1, pesoB2) ? 'ok' : 'erro', ''],
      ['Placa da Carreta', nf1.placa || NA, nf2.placa || NA, laudo.placa || NA, (normalizaPlaca(nf1.placa) === normalizaPlaca(laudo.placa) || normalizaPlaca(nf2.placa) === normalizaPlaca(laudo.placa)) ? 'ok' : 'erro', ''],
      ['Lacres', nf1.lacres || NA, nf2.lacres || NA, laudo.lacres || NA, lacresMatch, '']
    ];

    const lacresData = {
      nota1: nf1.lacres || 'N/A',
      nota2: nf2.lacres || 'N/A',
      laudo: laudo.lacres || 'N/A'
    };

    const produtoInfo = {
      produto: laudo.codigoProd || NA,
      dataFabricacao: laudo.data || NA,
      dataValidade: laudo.validade || NA
    };

    return { linhas, produtoInfo };
  }

  // UI: adiciona listeners quando DOM estiver pronto
  document.addEventListener('DOMContentLoaded', () => {
    const inputXml1 = document.getElementById('xml1');
    const inputXml2 = document.getElementById('xml2');
    const inputCsv = document.getElementById('csv');
    const resultadoTbody = document.querySelector('#resultado tbody');
    const inputs = [inputXml1, inputXml2, inputCsv].filter(Boolean);

    // Atualiza a label com confirmação do(s) arquivo(s) selecionado(s)
    const setLabelFiles = (input) => {
      if (!input) return;
      const lbl = document.querySelector(`label[for="${input.id}"]`);
      if (!lbl) return;
      let badge = lbl.querySelector('.file-chosen');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'file-chosen';
        lbl.appendChild(badge);
      }
      const files = input.files;
      if (!files || files.length === 0) {
        badge.textContent = 'nenhum arquivo selecionado';
        badge.classList.remove('ok');
        badge.title = '';
      } else if (files.length === 1) {
        badge.textContent = `${files[0].name}`;
        badge.classList.add('ok');
        badge.title = files[0].name;
      } else {
        badge.textContent = `${files.length} arquivo(s)`;
        badge.classList.add('ok');
        // título com primeiros nomes para referência
        const names = Array.from(files).slice(0,4).map(f => f.name).join('\n');
        badge.title = `${files.length} arquivos selecionados:\n${names}`;
      }
    };

    // inicializa as labels (caso já haja arquivos selecionados por algum motivo)
    inputs.forEach(i => setLabelFiles(i));

    const showRows = (linhas) => {
      if (!resultadoTbody) return;
      resultadoTbody.innerHTML = '';
      linhas.forEach(l => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${l[0]}</td><td>${l[1]}</td><td>${l[2]}</td><td>${l[3]}</td><td class="${l[4]}">${l[4] === 'ok' ? '🟢' : l[4] === 'erro' ? '🔴' : ''}</td><td></td>`;
        resultadoTbody.appendChild(tr);
      });
    };

    const produtoTbody = document.querySelector('#produto-info tbody');
    const showProductInfo = (info) => {
      if (!produtoTbody) return;
      produtoTbody.innerHTML = '';
      const tr = document.createElement('tr');
      // resultado sempre verde conforme solicitado
      const status = 'ok';
      tr.innerHTML = `<td>${info.produto}</td><td>${info.dataFabricacao}</td><td>${info.dataValidade}</td><td class="${status}">${'🟢'}</td>`;
      produtoTbody.appendChild(tr);
    };

    const handler = async () => {
      const f1 = inputXml1 && inputXml1.files && inputXml1.files[0];
      const f2 = inputXml2 && inputXml2.files && inputXml2.files[0];
      const fc = inputCsv && inputCsv.files && inputCsv.files[0];
      if (!f1 || !f2 || !fc) return;
      const result = await compararFiles(f1, f2, fc);
      // result contains { linhas, produtoInfo }
      showRows(result.linhas);
      showProductInfo(result.produtoInfo);
    };

    // Debounce simples
    let tId = null;
    inputs.forEach(inp => {
      inp.addEventListener('change', () => {
        // atualiza a confirmação visual imediatamente
        setLabelFiles(inp);
        clearTimeout(tId);
        tId = setTimeout(handler, 150);
      });
    });
  });

  // export functions for debugging (optional)
  window.__comparador = { parseXML, parseCSV, normalizaPeso, validadePorCodigo };

})();




