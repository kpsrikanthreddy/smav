const fs = require('fs');
const code = fs.readFileSync('/tmp/glossy.js', 'utf8');

// Find all occurrences of "VITE_" or "supabase" or "api"
const viteMatches = code.match(/VITE_[A-Z0-9_]+/g) || [];
console.log('VITE vars:', [...new Set(viteMatches)]);

const urls = code.match(/https?:\/\/[a-zA-Z0-9_.-]+(?:supabase\.co|[a-zA-Z0-9_.-]*)/g) || [];
console.log('URLs:', [...new Set(urls)].filter(u => u.includes('supabase') || u.includes('api') || u.includes('glossy')));

// Find definition of y
const idx = code.indexOf('/customer/me?mobile=');
if (idx !== -1) {
  console.log('Context around /customer/me:\n', code.slice(idx - 300, idx + 50));
}
