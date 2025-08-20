import React from 'react';
import Message from './Message';

const testContent = `## Test Header

This is a **bold** test with *italic* text.

### Subheader

- List item 1  
- List item 2
- List item 3

| Column 1 | Column 2 |
|----------|----------|
| Row 1    | Data 1   |
| Row 2    | Data 2   |

\`\`\`javascript
function test() {
  console.log("Hello World");
}
\`\`\`

Regular paragraph with inline \`code\` here.`;

export default function MarkdownTest() {
  return (
    <div className="p-4 bg-black min-h-screen">
      <h1 className="text-white mb-4">Markdown Test</h1>
      <Message role="assistant" content={testContent} />
    </div>
  );
}