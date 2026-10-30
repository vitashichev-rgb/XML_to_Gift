"use strict";

// Pure conversion functions; UI setup is at the end.
function giftEscape(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/([~=#{}:])/g, "\\$1");
}
const answerMark = /^(\(\s*([xхXХ]?)\s*\)|\[\s*([xхXХ]?)\s*\])\s*(.+)$/;
const numericMark = /^#\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?::(?:\d+(?:\.\d*)?|\.\d+))?)\s*$/;
const matchingOption = /\[\[([^\]\n]+)\]\]/;
const questionStart = /^\s*(\d+)[.)]\s*(\S.*)?$/;
function isAnswerLine(line) {
  const s = line.trim();
  return answerMark.test(s) || /^(?:or=|=)/i.test(s) || numericMark.test(s) || matchingOption.test(s);
}
function splitQuestions(text) {
  const chunks = [];
  let current = [];
  let answered = false;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const isNumbered = /^\s*\d+[.)]/.test(line);
    if (isNumbered && answered) {
      chunks.push(current.join("\n").trim());
      current = [];
      answered = false;
    }
    if (line.trim() || current.length) current.push(line);
    if (isAnswerLine(line)) answered = true;
  }
  if (current.some(line => line.trim())) chunks.push(current.join("\n").trim());
  return chunks;
}
function parseMatching(lines, title) {
  const first = lines.findIndex(s => matchingOption.test(s));
  if (first < 1) throw new Error(`${title}: перед вариантами соответствия должен быть текст вопроса.`);
  const header = lines[0].trim();
  const pairs = [];
  let label = "";
  for (const line of lines.slice(1)) {
    const match = line.match(matchingOption);
    if (!match) {
      label = [label, line].filter(Boolean).join(" ").trim();
      continue;
    }
    const before = line.slice(0, match.index).trim();
    label = [label, before].filter(Boolean).join(" ").trim();
    const variants = match[1].split(",").map(s => s.trim()).filter(Boolean);
    const correct = variants.filter(s => /^\([\s\S]+\)$/.test(s));
    if (!label || correct.length !== 1) throw new Error(`${title}: для каждого утверждения требуется ровно один ответ в круглых скобках.`);
    const right = correct[0].slice(1, -1).trim();
    if (!right) throw new Error(`${title}: пустой правильный ответ.`);
    pairs.push(`=${giftEscape(label)} -> ${giftEscape(right)}`);
    label = line.slice(match.index + match[0].length).trim();
  }
  if (label) throw new Error(`${title}: после последней пары обнаружен текст без ответа.`);
  if (pairs.length < 2) throw new Error(`${title}: для соответствия необходимо минимум две пары.`);
  return {type:"matching",gift:`::${title}::${giftEscape(header)} {\n${pairs.join("\n")}\n}\n\n`};
}
function labelKey(value) {
  return value.toLowerCase().replace(/а/g, "a").replace(/в/g, "b").replace(/с/g, "c");
}
// Each labelled answer is a distinct blank, not an alternative answer.
function parseMultiBlank(lines, title) {
  const tail = [];
  let pos = lines.length;
  while (pos >= 2) {
    const answer = lines[pos - 1].match(/^=\s*(.+)$/);
    const marker = lines[pos - 2].match(/^([a-zа-я])\)\s*$/i);
    if (!answer || !marker) break;
    tail.unshift({ label: labelKey(marker[1]), answer: answer[1].trim() });
    pos -= 2;
  }
  if (tail.length < 2) return null;
  if (new Set(tail.map(x => x.label)).size !== tail.length) throw new Error(`${title}: повторяются метки пропусков.`);
  const stem = lines.slice(0, pos).join("\n");
  if (!stem.trim()) throw new Error(`${title}: отсутствует текст вопроса с пропусками.`);
  let updated = stem;
  for (const item of tail) {
    if (!item.answer) throw new Error(`${title}: пустой ответ к пункту ${item.label}.`);
    // Only replace labels followed by an underline blank, not arbitrary mentions of letters.
    const marker = item.label === "a" ? "[aа]" : item.label === "b" ? "[bв]" : item.label === "c" ? "[cс]" : item.label;
    const re = new RegExp(`(${marker}\\)\\s*)(_{2,})`, "i");
    if (!re.test(updated)) throw new Error(`${title}: не найден пропуск «${item.label}) ____» в тексте.`);
    const placeholder = `CLOZEFIELD${item.label.toUpperCase()}TOKEN`;
    updated = updated.replace(re, (_, prefix) => prefix + placeholder);
  }
  if (/(?:^|\n)\s*[a-zа-я]\)\s*$/im.test(updated)) throw new Error(`${title}: осталась метка ответа без значения.`);
  if (/_{2,}/.test(updated)) throw new Error(`${title}: найдены пропуски без ответов.`);
  let safeText = giftEscape(updated);
  for (const item of tail) {
    safeText = safeText.replace(`CLOZEFIELD${item.label.toUpperCase()}TOKEN`, `{1:SHORTANSWER:=${giftEscape(item.answer)}}`);
  }
  return { type: "cloze", title, gift: `::${title}::${safeText}\n`, fields: tail.length };
}
function parseOne(block, idx) {
  const raw = block.split("\n").map(s=>s.trim()).filter(Boolean);
  if (!raw.length) return null;
  const title = `Вопрос ${idx+1}`;
  const lines = [raw[0].replace(/^\d+[.)]\s*/, ""), ...raw.slice(1)];
  const multiBlank = parseMultiBlank(lines,title);
  if (multiBlank) return multiBlank;
  if (lines.some(s=>matchingOption.test(s))) return parseMatching(lines,title);
  const first = lines.findIndex((s,i)=>i>0 && isAnswerLine(s));
  if (first<0) throw new Error(`${title}: ответы не обнаружены.`);
  const question = giftEscape(lines.slice(0,first).join("\n"));
  const answers = lines.slice(first);
  const markers = answers.map(s=>s.match(answerMark));
  if (markers.every(Boolean)) {
    const kinds = markers.map(m=>m[1][0]);
    if (new Set(kinds).size>1) throw new Error(`${title}: смешаны типы отметок ( ) и [ ].`);
    const good = markers.map(m=>!!(m[2]||m[3]));
    const count = good.filter(Boolean).length;
    if (!count) throw new Error(`${title}: не указан ни один правильный ответ.`);
    if (kinds[0]==="(" && count!==1) throw new Error(`${title}: одиночный выбор требует один правильный вариант.`);
    let body;
    if (kinds[0]==="(") {
      body=markers.map((m,i)=>(good[i]?"=":"~")+giftEscape(m[4].trim())).join("\n");
    } else {
      const base=Math.floor(10000000/count), rem=10000000%count;
      let n=0;
      body=markers.map((m,i)=>{
        const units=good[i]?base+(n++<rem?1:0):-10000000;
        const pct=(units/100000).toFixed(5).replace(/\.?0+$/, "");
        return `~%${pct}%${giftEscape(m[4].trim())}`;
      }).join("\n");
    }
    return {type:"choice",gift:`::${title}::${question} {\n${body}\n}\n\n`};
  }
  if (answers.every(s=>/^(?:or=|=)/i.test(s))) {
    const body=answers.map(s=>"="+giftEscape(s.replace(/^(?:or=|=)\s*/i,""))).join("\n");
    return {type:"short",gift:`::${title}::${question} {\n${body}\n}\n\n`};
  }
  if (answers.every(s=>numericMark.test(s))) {
    if (answers.length!==1) throw new Error(`${title}: укажи один числовой ответ.`);
    return {type:"numeric",gift:`::${title}::${question} {#${answers[0].match(numericMark)[1]}}\n\n`};
  }
  throw new Error(`${title}: смешанный либо неподдерживаемый формат ответов.`);
}
function convertTextToGift(text) {
  const blocks=splitQuestions(text);
  if (!blocks.length) throw new Error("Вставьте исходные вопросы.");
  const result=blocks.map((block,i)=>parseOne(block,i));
  return {gift:result.filter(v=>v.type!=="cloze").map(v=>v.gift).join("").trim(), clozeFiles:result.filter(v=>v.type==="cloze").map(v=>({name:v.title,gift:v.gift,fields:v.fields})), counts:result.reduce((acc,v)=>(acc[v.type]=(acc[v.type]||0)+1,acc),{})};
}

// Static pre-download validator. Does not replace Moodle's import validation.
function validateGift(gift, sourceText = "") {
  const errors = [], warnings = [];
  if (!gift.trim()) return {errors:["Результат GIFT пуст."], warnings, count:0};
  // Re-parse source so accidental omissions, invalid source syntax, and altered output are noticed.
  let expected;
  if (sourceText.trim()) {
    try { expected = convertTextToGift(sourceText); }
    catch (e) { errors.push("Исходные вопросы: " + e.message); }
  }
  if (expected && gift.trim() !== expected.gift.trim()) {
    warnings.push("Результат отличается от автоматически сформированного GIFT. Проверьте ручные правки.");
  }
  const headings = [...gift.matchAll(/^::([^\n]+?)::/gm)];
  if (!headings.length) errors.push("Не найдены заголовки вопросов формата ::Название::. Возможно, GIFT повреждён.");
  const unique = new Set();
  for (const h of headings) {
    if (unique.has(h[1])) warnings.push(`Повторяется название вопроса «${h[1]}».`);
    unique.add(h[1]);
  }
  let braces = 0, escaped = false;
  for (const ch of gift) {
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === "{") braces++;
    if (ch === "}") { braces--; if (braces < 0) {errors.push("Лишняя закрывающая фигурная скобка."); break;} }
  }
  if (braces !== 0) errors.push("Несбалансированные фигурные скобки в GIFT.");
  // This format is emitted by this converter: header, question, {answer lines}.
  const blocks = gift.trim().split(/\n\s*\n(?=::)/);
  for (const [i, block] of blocks.entries()) {
    const num = i+1;
    if (!/^::[^\n]+::/.test(block)) { errors.push(`Блок ${num}: отсутствует название вопроса.`); continue; }
    const open = block.indexOf("{");
    const close = block.lastIndexOf("}");
    if (open < 0 || close <= open) { errors.push(`Вопрос ${num}: отсутствует блок ответов {…}.`); continue; }
    const content = block.slice(open+1,close).trim();
    const choices = content.split("\n").map(x=>x.trim()).filter(Boolean);
    if (!choices.length) {errors.push(`Вопрос ${num}: нет ответов.`);continue;}
    const isMatching = choices.every(x=>/^=.+\s->\s.+$/.test(x));
    if (isMatching) {
      if (choices.length < 2) errors.push(`Вопрос ${num}: для соответствия нужны минимум две пары.`);
      const left = choices.map(x=>x.slice(1).split(/\s->\s/)[0]);
      if (new Set(left).size !== left.length) warnings.push(`Вопрос ${num}: повторяются формулировки в задании на соответствие.`);
      continue;
    }
    if (choices.some(x=>/->/.test(x)) && !isMatching) errors.push(`Вопрос ${num}: некорректная пара соответствия.`);
    const percent = choices.map(x=>x.match(/^~%([+-]?\d+(?:\.\d+)?)%/)).filter(Boolean);
    if (percent.length) {
      if (percent.length!==choices.length) errors.push(`Вопрос ${num}: смешаны процентные и обычные варианты.`);
      const good = percent.map(m=>Number(m[1])).filter(v=>v>0);
      const sum = good.reduce((a,b)=>a+b,0);
      if (!good.length || Math.abs(sum-100)>0.000011) errors.push(`Вопрос ${num}: сумма положительных весов ${sum.toFixed(5)}%, требуется 100%.`);
      if (percent.some(m=>Number(m[1])>100 || Number(m[1])< -100)) errors.push(`Вопрос ${num}: вес вне диапазона −100…100%.`);
      if (percent.some(m=>Number(m[1])<0)) warnings.push(`Вопрос ${num}: у неправильных ответов отрицательные веса; проверьте штрафы в Moodle.`);
    } else if (/^#/.test(content)) {
      if (!/^#[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?::(?:\d+(?:\.\d*)?|\.\d+))?$/.test(content)) errors.push(`Вопрос ${num}: неправильный формат числового ответа.`);
    } else if (!choices.every(x=>/^[=~]/.test(x))) {
      errors.push(`Вопрос ${num}: неизвестный формат ответа.`);
    } else if (!choices.some(x=>x.startsWith("="))) {
      errors.push(`Вопрос ${num}: не найден правильный ответ.`);
    }
    if (choices.some(x=>/^[=~]\s*$/.test(x))) errors.push(`Вопрос ${num}: пустой вариант ответа.`);
  }
  if (/\{\d+:(?:MC|MULTICHOICE|MULTICHOICE_S):/i.test(gift)) warnings.push("Обнаружен Cloze: импортируйте такие вопросы отдельно в формате Moodle Cloze.");
  return {errors:[...new Set(errors)], warnings:[...new Set(warnings)], count:headings.length};
}
if (typeof document!=="undefined") {
  const $=id=>document.getElementById(id);
  let clozeFiles = [];
  const clozeSection = document.createElement("section");
  clozeSection.id="clozeDownloads";
  clozeSection.style.cssText="margin:0 20px 20px;padding:16px;background:white;border:1px solid #dce2ea;border-radius:14px;display:none";
  function saveGift(text,name) {
    const url=URL.createObjectURL(new Blob([text],{type:"text/plain;charset=utf-8"}));
    const a=document.createElement("a");a.href=url;a.download=name+".gift";document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function renderClozeDownloads() {
    clozeSection.replaceChildren();
    clozeSection.style.display=clozeFiles.length?"block":"none";
    if(!clozeFiles.length)return;
    const heading=document.createElement("p");
    heading.textContent=`Cloze-вопросов: ${clozeFiles.length}. Каждый вопрос скачивается отдельно. При импорте в Moodle выберите формат «Вложенные ответы (Cloze)».`;
    clozeSection.appendChild(heading);
    clozeFiles.forEach((file,i)=>{
      const btn=document.createElement("button");btn.type="button";
      btn.style.cssText="width:auto;display:inline-block;margin:8px 8px 0 0;padding:12px";
      btn.textContent=`Скачать Cloze — ${file.name} (${file.fields} поля)`;
      btn.addEventListener("click",()=>saveGift(file.gift,`cloze_question_${i+1}`));
      clozeSection.appendChild(btn);
    });
  }
  const bar=document.querySelector(".buttons");
  const checkBtn=document.createElement("button");
  checkBtn.id="validateBtn"; checkBtn.type="button"; checkBtn.textContent="Проверить GIFT";
  bar.insertBefore(checkBtn,$("copyBtn"));
  const status=document.createElement("section");
  status.id="validationReport";status.setAttribute("role","status");status.setAttribute("aria-live","polite");
  status.style.cssText="margin:0 20px 20px;padding:16px;background:#fff;border:1px solid #dce2ea;border-radius:14px;display:none;white-space:pre-wrap;line-height:1.5";
  bar.insertAdjacentElement("afterend",status);
  status.insertAdjacentElement("afterend",clozeSection);
  function check(show=true) {
    const report=validateGift($("giftOutput").value,$("textInput").value);
    if (show) {
      status.style.display="block";
      status.textContent=`Проверено вопросов: ${report.count}\n` +
        (report.errors.length ? "❌ Ошибки:\n"+report.errors.map(x=>"• "+x).join("\n") : "✅ Критических ошибок не найдено.") +
        (report.warnings.length ? "\n⚠️ Предупреждения:\n"+report.warnings.map(x=>"• "+x).join("\n") : "") +
        "\nПроверка не гарантирует успешный импорт: протестируйте файл в Moodle.";
    }
    return report;
  }
  $("convertBtn").addEventListener("click",()=>{
    try {
      const converted=convertTextToGift($("textInput").value);
      clozeFiles=converted.clozeFiles;
      $("giftOutput").value=converted.gift;
      renderClozeDownloads();
      $("customAlertOverlay").style.display=clozeFiles.length?"flex":"none";
      if(converted.gift)check(true);
      else {status.style.display="block";status.textContent=`Обычных GIFT-вопросов нет. Подготовлено Cloze-файлов: ${clozeFiles.length}. Скачайте их отдельно ниже.`;}
    }
    catch(e){clozeFiles=[];renderClozeDownloads();$("giftOutput").value="";status.style.display="none";alert("Ошибка конвертации: "+e.message);}
  });
  checkBtn.addEventListener("click",()=>check(true));
  $("closeAlertBtn").addEventListener("click",()=>$("customAlertOverlay").style.display="none");
  $("copyBtn").addEventListener("click",()=>{
    const content=$("giftOutput").value;
    const report=check(true);
    if(report.errors.length) {alert("Скачивание остановлено: исправьте ошибки в GIFT (отчёт показан под кнопками).");return;}
    let name=prompt("Имя файла (без расширения):","questions");
    if(name===null)return;
    name=name.replace(/[\\/:*?"<>|\x00-\x1f]/g,"").trim()||"questions";
    const url=URL.createObjectURL(new Blob([content],{type:"text/plain;charset=utf-8"}));
    const a=document.createElement("a");a.href=url;a.download=name+".gift";document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  $("textInput").addEventListener("input",()=>{clozeFiles=[];renderClozeDownloads();});
  $("clearAll").addEventListener("click",()=>{clozeFiles=[];renderClozeDownloads();$("textInput").value="";$("giftOutput").value="";status.style.display="none";$("customAlertOverlay").style.display="none";window.scrollTo(0,0);});
}
if (typeof module!=="undefined")module.exports={convertTextToGift,splitQuestions,parseOne,validateGift};
