<script setup lang="ts">
import { computed } from 'vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

const props = defineProps<{
  content: string
  streaming?: boolean
}>()

function appendStreamingCursor(html: string) {
  if (!props.streaming) return html

  const cursorHtml = '<span class="chat-streaming-cursor" aria-hidden="true"></span>'
  if (typeof document === 'undefined') return `${html}${cursorHtml}`

  // marked 会把段落、列表和表格渲染成块级节点。
  // 光标必须进入最后一个可展示节点内部，否则会被排到新的一行。
  const template = document.createElement('template')
  template.innerHTML = html
  const cursorHosts = template.content.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote')
  const cursor = document.createElement('span')
  cursor.className = 'chat-streaming-cursor'
  cursor.setAttribute('aria-hidden', 'true')

  const lastHost = cursorHosts.item(cursorHosts.length - 1)
  if (lastHost) lastHost.append(cursor)
  else template.content.append(cursor)

  return template.innerHTML
}

const renderedHtml = computed(() => {
  const html = marked.parse(props.content, {
    async: false,
    breaks: true,
    gfm: true,
  })
  const htmlWithScrollableTables = html
    .replaceAll('<table>', '<div class="chat-markdown-table-wrap"><table>')
    .replaceAll('</table>', '</table></div>')

  const sanitizedHtml = DOMPurify.sanitize(htmlWithScrollableTables, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
    FORBID_ATTR: ['style'],
  })

  return appendStreamingCursor(sanitizedHtml)
})
</script>

<template>
  <!-- 流式阶段也持续解析 Markdown，HTML 由 DOMPurify 清理后才进入 v-html。 -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="chat-markdown" v-html="renderedHtml" />
</template>

<style scoped>
.chat-markdown {
  min-width: 0;
  overflow-wrap: anywhere;
  line-height: 1.65;
}

.chat-markdown :deep(.chat-streaming-cursor) {
  display: inline-block;
  width: 0.42em;
  height: 0.86em;
  margin-left: 0.14em;
  border-radius: 1px;
  background: color-mix(in srgb, var(--ui-text-highlighted) 82%, transparent);
  vertical-align: -0.06em;
  animation: chat-stream-cursor-blink 1s steps(1, end) infinite;
}

@keyframes chat-stream-cursor-blink {
  0%,
  48% {
    opacity: 0.9;
  }

  49%,
  100% {
    opacity: 0.16;
  }
}

@media (prefers-reduced-motion: reduce) {
  .chat-markdown :deep(.chat-streaming-cursor) {
    animation: none;
    opacity: 0.65;
  }
}

.chat-markdown :deep(p),
.chat-markdown :deep(ul),
.chat-markdown :deep(ol),
.chat-markdown :deep(blockquote),
.chat-markdown :deep(pre) {
  margin: 0.65rem 0;
}

.chat-markdown :deep(h1),
.chat-markdown :deep(h2),
.chat-markdown :deep(h3),
.chat-markdown :deep(h4) {
  margin: 0.9rem 0 0.45rem;
  color: var(--ui-text-highlighted);
  font-weight: 650;
  line-height: 1.4;
}

.chat-markdown :deep(h1) {
  font-size: 1.08rem;
}
.chat-markdown :deep(h2) {
  font-size: 1rem;
}
.chat-markdown :deep(h3),
.chat-markdown :deep(h4) {
  font-size: 0.925rem;
}

.chat-markdown :deep(ul),
.chat-markdown :deep(ol) {
  padding-left: 1.35rem;
}

.chat-markdown :deep(li + li) {
  margin-top: 0.3rem;
}

.chat-markdown :deep(strong) {
  color: var(--ui-text-highlighted);
  font-weight: 650;
}

.chat-markdown :deep(a) {
  color: var(--ui-primary);
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--ui-primary) 45%, transparent);
  text-underline-offset: 0.18em;
}

.chat-markdown :deep(blockquote) {
  border-left: 2px solid color-mix(in srgb, var(--ui-primary) 45%, var(--app-border));
  padding-left: 0.8rem;
  color: var(--ui-text-muted);
}

.chat-markdown :deep(code) {
  border: 1px solid var(--app-border);
  border-radius: 0.4rem;
  background: var(--app-surface-muted);
  padding: 0.08rem 0.32rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.84em;
}

.chat-markdown :deep(pre) {
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  border: 1px solid var(--app-border);
  border-radius: 0.8rem;
  background: var(--app-surface-muted);
  padding: 0.8rem 0.9rem;
}

.chat-markdown :deep(pre code) {
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0;
  font-size: 0.78rem;
  line-height: 1.65;
  white-space: pre;
}

.chat-markdown :deep(hr) {
  margin: 0.9rem 0;
  border: 0;
  border-top: 1px solid var(--app-border);
}

.chat-markdown :deep(.chat-markdown-table-wrap) {
  width: 100%;
  max-width: 100%;
  margin: 0.75rem 0;
  overflow-x: auto;
  border: 1px solid var(--app-border);
  border-radius: 0.75rem;
  overscroll-behavior-inline: contain;
}

.chat-markdown :deep(table) {
  width: 100%;
  min-width: 28rem;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 0.78rem;
  line-height: 1.55;
}

.chat-markdown :deep(th),
.chat-markdown :deep(td) {
  min-width: 6.5rem;
  padding: 0.55rem 0.65rem;
  border-right: 1px solid var(--app-border);
  border-bottom: 1px solid var(--app-border);
  text-align: left;
  vertical-align: top;
  white-space: normal;
}

.chat-markdown :deep(th) {
  background: var(--app-surface-muted);
  color: var(--ui-text-highlighted);
  font-weight: 650;
}

.chat-markdown :deep(th:first-child),
.chat-markdown :deep(td:first-child) {
  width: 26%;
}

.chat-markdown :deep(tr:last-child td) {
  border-bottom: 0;
}

.chat-markdown :deep(th:last-child),
.chat-markdown :deep(td:last-child) {
  border-right: 0;
}

.chat-markdown :deep(tbody tr:nth-child(even)) {
  background: color-mix(in srgb, var(--app-surface-muted) 52%, transparent);
}

.chat-markdown > :deep(:first-child) {
  margin-top: 0;
}
.chat-markdown > :deep(:last-child) {
  margin-bottom: 0;
}
</style>
