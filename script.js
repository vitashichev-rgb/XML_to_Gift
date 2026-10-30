'use strict';
const $ = (id) => document.getElementById(id);

function triggerFileInput() { $('fileInput').click(); }
$('fileInput').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    $('xmlInput').value = e.target.result;
    $('giftOutput').value = '';
    clearErrorUI();
    event.target.value = '';
  };
  reader.onerror = () => logErrorToUI('Ошибка при чтении файла.');
  reader.readAsText(file, 'utf-8');
});
function logErrorToUI(message) {
  const p = document.createElement('p');
  p.textContent = message;
  $('errorOutput').appendChild(p);
  $('errorLog').classList.remove('hidden');
}
function clearErrorUI() {
  $('errorOutput').replaceChildren();
  $('errorLog').classList.add('hidden');
}
function cleanText(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').replace(/[^\wа-яё\s]/gi, '').trim();
}
function parseMarkdownChoices(markdown) {
  if (!markdown) return [];
  return markdown.replace(/&#10;/g, '\n').split('\n').map(line => {
    const match = line.match(/^\s*[\[\(]\s*([xх])?\s*[\]\)]\s*(.+)$/i);
    return match ? {text: match[2].trim(), correct: !!match[1]} : null;
  }).filter(Boolean);
}
function parseXMLToQuestions(rawXML) {
  if (!rawXML.trim()) { logErrorToUI('Введите XML или загрузите файл.'); return []; }
  const xmlDoc = new DOMParser().parseFromString(rawXML, 'application/xml');
  if (xmlDoc.getElementsByTagName('parsererror').length) {
    logErrorToUI('Ошибка при разборе XML. Проверьте корректность документа.');
    return [];
  }
  const root = xmlDoc.getElementsByTagName('quiz')[0] || xmlDoc.getElementsByTagName('problems')[0] || xmlDoc;
  const problems = Array.from(root.getElementsByTagName('problem'));
  const questions = [];
  if (!problems.length) logErrorToUI('В XML не найдены элементы <problem>.');
  const tags = {
    multiplechoiceresponse: ['single', 'choicegroup'],
    choiceresponse: ['multi', 'checkboxgroup'],
    stringresponse: ['fill-in-the-blank', ''],
    numericalresponse: ['numerical', ''],
    optionresponse: ['option', '']
  };

  function addQuestion(problem, resp, textNodes, problemIndex, responseIndex) {
    const [type, groupTag] = tags[resp.tagName.toLowerCase()];
    const baseTitle = problem.getAttribute('display_name');
    const title = (baseTitle && responseIndex === 1 &&
      Array.from(problem.children).filter(el => tags[el.tagName.toLowerCase()]).length === 1)
      ? baseTitle : `Вопрос ${questions.length + 1}`;
    const questionText = textNodes.map(el => el.textContent.trim()).filter(Boolean)
      .join('\\n').replace(/^\s*\d+\s*[.\)>»]*\s*/, '');
    if (!questionText) { logErrorToUI(`Вопрос ${problemIndex + 1}.${responseIndex} пропущен: отсутствует текст вопроса.`); return; }

    if (groupTag) {
      const group = resp.getElementsByTagName(groupTag)[0];
      if (!group) { logErrorToUI(`Вопрос "${title}" пропущен: отсутствует <${groupTag}>.`); return; }
      const nodes = Array.from(group.getElementsByTagName('choice'));
      if (!nodes.length) { logErrorToUI(`Вопрос "${title}" пропущен: нет вариантов ответов.`); return; }
      let answers = nodes.map(ch => ({text: ch.textContent.trim(), correct: ch.getAttribute('correct') === 'true'}));
      if (!answers.some(a => a.correct)) {
        const mdChoices = parseMarkdownChoices(problem.getAttribute('markdown'));
        if (mdChoices.length) {
          answers = answers.map(a => {
            const md = mdChoices.find(x => cleanText(x.text) === cleanText(a.text));
            return {text:a.text, correct: md ? md.correct : false};
          });
          if (answers.some(a => a.correct)) logErrorToUI(`Вопрос "${title}": правильный ответ восстановлен из markdown.`);
        }
      }
      if (!answers.some(a => a.correct)) { logErrorToUI(`Вопрос "${title}" пропущен: отсутствует правильный ответ.`); return; }
      // Даже multiplechoiceresponse может содержать несколько correct=true.
      // Такие вопросы автоматически экспортируются как множественный выбор.
      const resolvedType = answers.filter(a => a.correct).length > 1 ? 'multi' : type;
      questions.push({title, question:questionText, answers, type:resolvedType});
    } else if (type === 'fill-in-the-blank') {
      const main = resp.getAttribute('answer');
      if (!main) { logErrorToUI(`Вопрос "${title}" пропущен: отсутствует атрибут answer.`); return; }
      const additional = Array.from(resp.getElementsByTagName('additional_answer')).map(a => a.getAttribute('answer')).filter(Boolean);
      questions.push({title, question:questionText, answers:[main, ...additional], type});
    } else if (type === 'numerical') {
      const answer = resp.getAttribute('answer');
      if (!answer) { logErrorToUI(`Вопрос "${title}" пропущен: отсутствует атрибут answer.`); return; }
      questions.push({title, question:questionText, answers:[answer], type});
    } else if (type === 'option') {
      const opt = resp.getElementsByTagName('optioninput')[0];
      if (!opt) { logErrorToUI(`Вопрос "${title}" пропущен: отсутствует <optioninput>.`); return; }
      const correct = opt.getAttribute('correct')?.trim().toLowerCase();
      if (!['да','нет'].includes(correct)) { logErrorToUI(`Вопрос "${title}" пропущен: correct должен быть «да» или «нет».`); return; }
      questions.push({title, question:questionText, answers:[correct], type});
    }
  }

  problems.forEach((problem, problemIndex) => {
    let pendingText = [];
    let responseIndex = 0;
    // Each response consumes the immediately preceding question text. This
    // handles multiple <p> + <multiplechoiceresponse> pairs in ONE <problem>.
    for (const child of Array.from(problem.children)) {
      const tag = child.tagName.toLowerCase();
      if (tags[tag]) {
        responseIndex++;
        addQuestion(problem, child, pendingText, problemIndex, responseIndex);
        pendingText = [];
      } else if (['p', 'label', 'b'].includes(tag)) {
        pendingText.push(child);
      }
    }
    // Backwards compatibility with a response nested inside an extra wrapper.
    if (responseIndex === 0) {
      const resp = Array.from(problem.getElementsByTagName('*')).find(el => tags[el.tagName.toLowerCase()]);
      if (resp) {
        const label = problem.getElementsByTagName('label')[0];
        const paragraphs = Array.from(problem.getElementsByTagName('p'));
        const bold = Array.from(problem.getElementsByTagName('b'));
        addQuestion(problem, resp, label ? [label] : paragraphs.length ? paragraphs : bold, problemIndex, 1);
      } else {
        logErrorToUI(`Блок <problem> ${problemIndex + 1} пропущен: не найден тег ответа.`);
      }
    }
  });
  return questions;
}
// Backslash-escape GIFT control symbols that occur in ordinary answer/question text.
function escapeGift(text) { return String(text).replace(/([\\~=#{}:])/g, '\\$1'); }
function escapeQuestion(text) {
  // Preserve existing literal \\n question-paragraph separators, used by original converter.
  return String(text).split('\\n').map(escapeGift).join('\\n');
}
function convertToGIFT(questions) {
  return questions.map(q => {
    const header = `::${escapeGift(q.title)}:: ${escapeQuestion(q.question)}`;
    if (q.type === 'single') {
      const body = q.answers.map(a => `${a.correct ? '=' : '~'} ${escapeGift(a.text)}`).join('\n');
      return `${header} {\n${body}\n}`;
    }
    if (q.type === 'multi') {
      const n = q.answers.filter(a => a.correct).length;
      // GIFT accepts up to five decimals in our export. Allocate weights in
      // 0.00001% units, distributing the remainder so the sum is EXACTLY 100%.
      const totalUnits = 10000000;
      const baseUnits = Math.floor(totalUnits / n);
      const remainder = totalUnits % n;
      let correctIndex = 0;
      const body = q.answers.map(a => {
        if (!a.correct) return `~%-100% ${escapeGift(a.text)}`;
        const units = baseUnits + (correctIndex++ < remainder ? 1 : 0);
        return `~%${(units / 100000).toFixed(5)}% ${escapeGift(a.text)}`;
      }).join('\n');
      return `${header} {\n${body}\n}`;
    }
    if (q.type === 'fill-in-the-blank') return `${header} {${q.answers.map(a => '=' + escapeGift(a)).join(' ')}}`;
    if (q.type === 'numerical') return `${header} {#${q.answers[0]}}`;
    if (q.type === 'option') {
      const yes = q.answers[0] === 'да';
      return `${header} {\n${yes ? '= да\n~ нет' : '= нет\n~ да'}\n}`;
    }
    return '';
  }).filter(Boolean).join('\n\n');
}
function previewGIFT() {
  clearErrorUI();
  const questions = parseXMLToQuestions($('xmlInput').value);
  $('giftOutput').value = convertToGIFT(questions);
}
function convertXMLToGIFT() {
  clearErrorUI();
  let giftText = $('giftOutput').value.trim();
  if (!giftText) {
    const questions = parseXMLToQuestions($('xmlInput').value);
    giftText = convertToGIFT(questions);
    $('giftOutput').value = giftText;
  }
  if (!giftText) { logErrorToUI('Нет данных GIFT для сохранения.'); return; }
  const filename = prompt('Введите имя файла для сохранения (без расширения):', 'questions');
  if (!filename || !filename.trim()) return;
  const safe = filename.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '') || 'questions';
  const blob = new Blob(['\uFEFF', giftText], {type:'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safe + '.gift';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function clearAll() { $('xmlInput').value = ''; $('giftOutput').value = ''; clearErrorUI(); $('fileInput').value = ''; }
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); alert('Скопировано в буфер обмена.'); }
  catch (err) { logErrorToUI(`Ошибка при копировании: ${err.message}`); }
}
$('uploadButton').addEventListener('click', triggerFileInput);
$('previewButton').addEventListener('click', previewGIFT);
$('downloadButton').addEventListener('click', convertXMLToGIFT);
$('clearButton').addEventListener('click', clearAll);
$('copyButton').addEventListener('click', () => copyText('<problems>\n</problems>'));
$('copyButtonTwo').addEventListener('click', () => copyText('<problem>\n</problem>'));
