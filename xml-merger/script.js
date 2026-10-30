'use strict';

const fileInput = document.getElementById('fileInput');
const fileLabel = document.querySelector('label[for="fileInput"]');
const output = document.getElementById('mergedOutput');
const status = document.getElementById('status');
const mergeButton = document.getElementById('mergeButton');

function showStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}

fileInput.addEventListener('change', () => {
  const count = fileInput.files.length;
  fileLabel.classList.toggle('selected', count > 0);
  fileLabel.textContent = count ? `Файлов выбрано: ${count}` : '1. Выберите файлы';
  showStatus('');
});

function parseXML(source, filename = 'XML') {
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error(`Некорректный XML: ${filename}`);
  }
  return doc;
}

// Indent only element-only content. Do not change text nodes inside questions/answers.
function formatXML(xmlString) {
  const doc = parseXML(xmlString);
  const serializer = new XMLSerializer();
  function print(element, level) {
    const pad = '  '.repeat(level);
    const nodes = Array.from(element.childNodes);
    const hasNonWhitespaceText = nodes.some(n =>
      (n.nodeType === Node.TEXT_NODE || n.nodeType === Node.CDATA_SECTION_NODE) && n.nodeValue.trim()
    );
    if (hasNonWhitespaceText || nodes.some(n => n.nodeType !== Node.ELEMENT_NODE && n.nodeType !== Node.TEXT_NODE)) {
      return pad + serializer.serializeToString(element);
    }
    const children = nodes.filter(n => n.nodeType === Node.ELEMENT_NODE);
    if (!children.length) return pad + serializer.serializeToString(element);
    const openTag = serializer.serializeToString(element.cloneNode(false)).replace(/\s*\/>$/, '>');
    return pad + openTag + '\n' + children.map(n => print(n, level + 1)).join('\n') + '\n' + pad + `</${element.tagName}>`;
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + print(doc.documentElement, 0) + '\n';
}

async function mergeFiles() {
  const files = Array.from(fileInput.files);
  if (!files.length) { showStatus('Сначала выберите XML-файлы.', true); return; }
  mergeButton.disabled = true;
  showStatus('Чтение файлов...');
  try {
    // Promise.all retains the chosen file order even if reads finish out of order.
    const sources = await Promise.all(files.map(file => file.text()));
    const merged = document.implementation.createDocument('', 'problems', null);
    const root = merged.documentElement;
    let count = 0;
    sources.forEach((source, index) => {
      const doc = parseXML(source, files[index].name);
      const problems = Array.from(doc.getElementsByTagName('problem'));
      problems.forEach(problem => {
        const imported = merged.importNode(problem, true);
        imported.setAttribute('display_name', String(++count));
        root.appendChild(imported);
      });
    });
    if (!count) throw new Error('В выбранных файлах нет элементов <problem>.');
    output.value = formatXML(new XMLSerializer().serializeToString(merged));
    showStatus(`Объединено файлов: ${files.length}; блоков <problem>: ${count}.`);
  } catch (error) {
    showStatus(error.message || 'Не удалось объединить файлы.', true);
  } finally {
    mergeButton.disabled = false;
  }
}

function formatMergedXML() {
  try {
    if (!output.value.trim()) throw new Error('Сначала объедините файлы или вставьте XML.');
    const doc = parseXML(output.value);
    for (const element of doc.getElementsByTagName('*')) {
      ['markdown', 'max_attempts', 'showanswer', 'display_name'].forEach(attr => element.removeAttribute(attr));
    }
    output.value = formatXML(new XMLSerializer().serializeToString(doc));
    showStatus('Форматирование выполнено. Лишние атрибуты удалены.');
  } catch (error) {
    showStatus(error.message || 'Ошибка форматирования.', true);
  }
}

function downloadMergedXML() {
  try {
    const xml = output.value.trim();
    if (!xml) throw new Error('Нет XML для скачивания.');
    parseXML(xml);
    const blob = new Blob([output.value], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'merged.xml';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showStatus('Файл merged.xml подготовлен к скачиванию.');
  } catch (error) {
    showStatus(error.message || 'Ошибка сохранения.', true);
  }
}

document.getElementById('mergeButton').addEventListener('click', mergeFiles);
document.getElementById('formatButton').addEventListener('click', formatMergedXML);
document.getElementById('downloadButton').addEventListener('click', downloadMergedXML);
