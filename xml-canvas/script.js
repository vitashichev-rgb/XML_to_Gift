"use strict";
const ANSWER_TAGS = new Set(["multiplechoiceresponse", "choiceresponse", "stringresponse", "numericalresponse", "optionresponse"]);
const getTag = (el) => el.localName.toLowerCase();
const escapeGift = (text) => String(text ?? "").replace(/\\/g, "\\\\").replace(/([~=#{}:])/g, "\\$1");
const cleanQuestion = (text) => String(text || "").trim().replace(/^\d+[.)]\s*/, "");
const status = (text) => { document.getElementById("status").textContent = text; };

function splitQuestions(problem) {
  const out = [];
  let textParts = [];
  let clozeParts = [];
  const flushCloze = () => {
    if (clozeParts.length) {
      out.push({type:"cloze", question: textParts.join("\n").trim(), fields:clozeParts});
      textParts = []; clozeParts = [];
    }
  };
  for (const el of problem.children) {
    const tag = getTag(el);
    if (tag === "p" || tag === "b" || tag === "label") {
      // A new numbered paragraph after an optionresponse begins another Cloze question.
      const t = el.textContent.trim();
      if (clozeParts.length && /^\d+[.)]\s/.test(t)) flushCloze();
      textParts.push(t);
    } else if (ANSWER_TAGS.has(tag)) {
      if (tag === "optionresponse") {
        // Keep optionresponse questions together, and preserve associated paragraphs.
        const label = textParts.pop() || "";
        clozeParts.push({label, node:el});
      } else {
        flushCloze();
        const label = el.querySelector("label");
        out.push({type:"standard", question:(label?.textContent.trim() || textParts.join("\n").trim()), node:el});
        textParts = [];
      }
    }
  }
  flushCloze();
  return out;
}
function weights(count) {
  const base = Math.floor(10000000 / count); // 100% in 0.00001% units
  const rem = 10000000 - base * count;
  return Array.from({length:count}, (_,i) => ((base + (i < rem ? 1 : 0)) / 100000).toFixed(5).replace(/\.0+$/, ""));
}
function choicesGift(node, multiple) {
  const group = node.querySelector(multiple ? "checkboxgroup" : "choicegroup");
  if (!group) throw Error("В вопросе отсутствует группа вариантов ответа.");
  const choices = Array.from(group.querySelectorAll("choice"));
  const correctCount = choices.filter(c=>c.getAttribute("correct")?.toLowerCase()==="true").length;
  if (!choices.length || !correctCount) throw Error("В вопросе нет вариантов или правильного ответа.");
  const useWeights = multiple || correctCount>1;
  const shares = weights(correctCount);
  let k=0;
  return choices.map(c=>{
    const answer = escapeGift(c.textContent.trim());
    const correct = c.getAttribute("correct")?.toLowerCase()==="true";
    return useWeights ? (correct ? `~%${shares[k++]}%${answer}` : `~%-100%${answer}`) : (correct ? `=${answer}` : `~${answer}`);
  }).join("\n");
}
function optionData(node) {
  const input = node.querySelector("optioninput");
  if (!input) throw Error("В optionresponse отсутствует optioninput.");
  const choices = (input.getAttribute("options") || "").replace(/[()']/g, "").split(",").map(x=>x.trim()).filter(Boolean);
  const correct = (input.getAttribute("correct") || "").trim().replace(/^['"]|['"]$/g, "");
  if (!choices.length || !choices.includes(correct)) throw Error("В Cloze не указан правильный вариант среди options.");
  return {choices,correct};
}
function clozeField(node) {
  const {choices,correct}=optionData(node);
  return `{1:MULTICHOICE:${choices.map(v=> (v===correct ? "=" : "~") + escapeGift(v)).join("")}}`;
}
function convertQuestions(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw Error("Некорректный XML. Проверьте закрывающие теги и специальные символы.");
  const problems = Array.from(doc.getElementsByTagName("problem"));
  if (!problems.length) throw Error("Тег <problem> не найден.");
  const all = problems.flatMap(splitQuestions);
  if (!all.length) throw Error("Не найдены вопросы с ответами.");
  const gift = [], clozeFiles = [];
  let standardNumber=0;
  for (const q of all) {
    if (q.type === "cloze") {
      const fields = q.fields.map(f=>[cleanQuestion(f.label),clozeField(f.node)].filter(Boolean).join(" "));
      clozeFiles.push([cleanQuestion(q.question),...fields].filter(Boolean).join("\n"));
      continue;
    }
    const title = `Вопрос ${++standardNumber}`;
    const tag = getTag(q.node);
    let body;
    if (tag === "multiplechoiceresponse" || tag === "choiceresponse") body = choicesGift(q.node,tag==="choiceresponse");
    else if (tag === "stringresponse") {
      const vals = [q.node.getAttribute("answer"), ...Array.from(q.node.querySelectorAll("additional_answer"),e=>e.getAttribute("answer"))].filter(x=>x!=null && x.trim());
      if (!vals.length) throw Error(`${title}: не найден текст ответа.`);
      body = vals.map(a=>"="+escapeGift(a.trim())).join("\n");
    } else if (tag === "numericalresponse") {
      const val = q.node.getAttribute("answer")?.trim();
      if (!val) throw Error(`${title}: не указан числовой ответ.`);
      body = "#"+val.replace(/^#/,"");
    }
    gift.push(`::${title}:: ${escapeGift(cleanQuestion(q.question))} {\n${body}\n}`);
  }
  return {standard:gift.join("\n\n"), cloze:clozeFiles};
}
let lastCloze=[];
document.getElementById("convertBtn").addEventListener("click",()=>{
  document.getElementById("customAlertOverlay").style.display="none";
  const input=document.getElementById("xmlInput").value.trim();
  if(!input){status("Вставьте XML.");return;}
  try {
    const result=convertQuestions(input);
    lastCloze=result.cloze;
    document.getElementById("giftOutput").value=result.standard || (lastCloze.length===1 ? lastCloze[0] : "");
    status(`Обычных вопросов: ${result.standard ? result.standard.split(/\n\n::Вопрос /).length : 0}; Cloze: ${lastCloze.length}.`);
    if(lastCloze.length){document.getElementById("customAlertOverlay").style.display="flex";}
  }catch(e){status("Ошибка: "+e.message);}
});
document.getElementById("downloadBtn").addEventListener("click",()=>{
  const text=document.getElementById("giftOutput").value;
  if(!text.trim()){alert("Нет данных для скачивания. Для Cloze используйте отдельный вопрос.");return;}
  if(lastCloze.length && text.includes("::Вопрос")){
    alert("В общем файле только обычные вопросы. Cloze-вопросы следует сохранять по одному отдельно.");
  }
  let filename=prompt("Название файла без расширения:","questions");
  if(filename===null)return;
  filename=filename.replace(/[\\/:*?"<>|]/g,"").trim()||"questions";
  const url=URL.createObjectURL(new Blob([text],{type:"text/plain;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download=filename+".gift";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
document.getElementById("closeAlertBtn").addEventListener("click",()=>document.getElementById("customAlertOverlay").style.display="none");
document.querySelectorAll(".copy-problem").forEach(el=>el.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(el.dataset.code);status("Теги скопированы.");}catch{status("Копирование недоступно. Выделите текст вручную.");}}));
