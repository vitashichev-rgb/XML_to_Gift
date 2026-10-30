"use strict";

// Encode text which would otherwise be interpreted as GIFT syntax.
function giftEscape(value) {
  return value.replace(/\\/g, "\\\\").replace(/([~=#{}:])/g, "\\$1");
}
const answerMark = /^(?:\(\s*([xхXХ]?)\s*\)|\[\s*([xхXХ]?)\s*\])\s+(.+)$/;
const numericMark = /^#\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?::(?:\d+(?:\.\d*)?|\.\d+))?)\s*$/;
function isAnswerLine(line) {
  const s = line.trim();
  return answerMark.test(s) || /^(?:or=|=)/i.test(s) || numericMark.test(s);
}
function splitQuestions(text) {
  const chunks = [];
  let current = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const beginsQuestion = /^\s*\d+[.)]\s+\S/.test(line);
    // Do not split question on a numbered line unless it already has an answer.
    if (beginsQuestion && current.some(isAnswerLine)) {
      chunks.push(current.join("\n").trim());
      current = [];
    }
    if (line.trim() || current.length) current.push(line);
  }
  if (current.some(s => s.trim())) chunks.push(current.join("\n").trim());
  return chunks;
}
function clozeField(content) {
  const options = content.split(",").map(s => s.trim()).filter(Boolean);
  const correct = options.filter(s => /^\(.*\)$/.test(s));
  if (correct.length !== 1 || options.length < 2) throw new Error("Cloze должен иметь один правильный вариант в круглых скобках и хотя бы два варианта.");
  const items = options.map(s => {
    const good = /^\(.*\)$/.test(s);
    const word = good ? s.slice(1, -1).trim() : s;
    return (good ? "=" : "~") + giftEscape(word);
  });
  return `{1:MULTICHOICE:${items.join("")}}`;
}
function parseOne(block, idx) {
  const raw = block.split("\n").map(s => s.trim()).filter(Boolean);
  if (!raw.length) return null;
  const title = `Вопрос ${idx + 1}`;
  const firstLine = raw[0].replace(/^\d+[.)]\s+/, "");
  const lines = [firstLine, ...raw.slice(1)];
  const allText = lines.join("\n");
  if (/\[\[[\s\S]*?\]\]/.test(allText)) {
    const text = allText.replace(/\[\[([\s\S]*?)\]\]/g, (_, content) => clozeField(content));
    return { type: "cloze", gift: text + "\n\n" };
  }
  const index = lines.findIndex((line, i) => i > 0 && isAnswerLine(line));
  if (index < 0) throw new Error(`${title}: не обнаружены ответы.`);
  const question = giftEscape(lines.slice(0, index).join("\n"));
  const answers = lines.slice(index);
  const markers = answers.map(s => s.match(answerMark));
  if (markers.every(Boolean)) {
    const kinds = markers.map(m => m[0].trim()[0]);
    if (new Set(kinds).size > 1) throw new Error(`${title}: нельзя смешивать ( ) и [ ] в одном вопросе.`);
    const correct = markers.map(m => Boolean(m[1] || m[2]));
    const count = correct.filter(Boolean).length;
    if (!count) throw new Error(`${title}: не отмечен правильный ответ.`);
    if (kinds[0] === "(" && count !== 1) throw new Error(`${title}: одиночный выбор должен иметь ровно один правильный ответ.`);
    let body;
    if (kinds[0] === "(") {
      body = markers.map((m, i) => (correct[i] ? "=" : "~") + giftEscape(m[3])).join("\n");
    } else {
      // Allocate integer units of 0.00001%; exact sum of correct weights = 100%.
      const base = Math.floor(10000000 / count);
      const remainder = 10000000 % count;
      let used = 0;
      body = markers.map((m, i) => {
        const value = correct[i] ? base + (used++ < remainder ? 1 : 0) : -10000000;
        const pct = (value / 100000).toFixed(5).replace(/\.?0+$/, "");
        return `~%${pct}%` + giftEscape(m[3]);
      }).join("\n");
    }
    return { type: "choice", gift: `::${title}::${question} {\n${body}\n}\n\n` };
  }
  if (answers.every(s => /^(?:or=|=)/i.test(s))) {
    const body = answers.map(s => "=" + giftEscape(s.replace(/^(?:or=|=)\s*/i, ""))).join("\n");
    return { type: "short", gift: `::${title}::${question} {\n${body}\n}\n\n` };
  }
  if (answers.every(s => numericMark.test(s))) {
    if (answers.length !== 1) throw new Error(`${title}: для числового вопроса укажи один ответ.`);
    const number = answers[0].match(numericMark)[1];
    return { type: "numeric", gift: `::${title}::${question} {#${number}}\n\n` };
  }
  throw new Error(`${title}: неподдерживаемый или смешанный формат ответов.`);
}
function convertTextToGift(text) {
  const blocks = splitQuestions(text);
  if (!blocks.length) throw new Error("Вставьте исходные вопросы.");
  const converted = blocks.map((block, i) => parseOne(block, i));
  return { gift: converted.map(v => v.gift).join("").trim(), cloze: converted.some(v => v.type === "cloze") };
}
const $ = id => document.getElementById(id);
$("convertBtn").addEventListener("click", () => {
  try {
    const { gift, cloze } = convertTextToGift($("textInput").value);
    $("giftOutput").value = gift;
    $("customAlertOverlay").style.display = cloze ? "flex" : "none";
  } catch (error) {
    $("giftOutput").value = "";
    $("customAlertOverlay").style.display = "none";
    alert("Ошибка конвертации: " + error.message);
  }
});
$("closeAlertBtn").addEventListener("click", () => $("customAlertOverlay").style.display = "none");
$("copyBtn").addEventListener("click", () => {
  const content = $("giftOutput").value;
  if (!content.trim()) return alert("Нет данных для скачивания!");
  let name = prompt("Введите название файла (без расширения):", "questions");
  if (name === null) return;
  name = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "").trim() || "questions";
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = name + ".gift";
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("clearAll").addEventListener("click", () => {
  $("textInput").value = "";
  $("giftOutput").value = "";
  $("customAlertOverlay").style.display = "none";
  window.scrollTo(0, 0);
});
