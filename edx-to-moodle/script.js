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
function parseOne(block, idx) {
  const raw = block.split("\n").map(s=>s.trim()).filter(Boolean);
  if (!raw.length) return null;
  const title = `Вопрос ${idx+1}`;
  const lines = [raw[0].replace(/^\d+[.)]\s*/, ""), ...raw.slice(1)];
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
  return {gift:result.map(v=>v.gift).join("").trim(), counts:result.reduce((acc,v)=>(acc[v.type]=(acc[v.type]||0)+1,acc),{})};
}
if (typeof document!=="undefined") {
  const $=id=>document.getElementById(id);
  $("convertBtn").addEventListener("click",()=>{
    try {$("giftOutput").value=convertTextToGift($("textInput").value).gift;$("customAlertOverlay").style.display="none";}
    catch(e){$("giftOutput").value="";alert("Ошибка конвертации: "+e.message);}
  });
  $("closeAlertBtn").addEventListener("click",()=>$("customAlertOverlay").style.display="none");
  $("copyBtn").addEventListener("click",()=>{
    const content=$("giftOutput").value;
    if(!content.trim())return alert("Нет данных для скачивания!");
    let name=prompt("Имя файла (без расширения):","questions");
    if(name===null)return;
    name=name.replace(/[\\/:*?"<>|\x00-\x1f]/g,"").trim()||"questions";
    const url=URL.createObjectURL(new Blob([content],{type:"text/plain;charset=utf-8"}));
    const a=document.createElement("a");a.href=url;a.download=name+".gift";document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  $("clearAll").addEventListener("click",()=>{$("textInput").value="";$("giftOutput").value="";$("customAlertOverlay").style.display="none";window.scrollTo(0,0);});
}
if (typeof module!=="undefined")module.exports={convertTextToGift,splitQuestions,parseOne};
