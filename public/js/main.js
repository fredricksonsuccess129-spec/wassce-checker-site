// main.js: fetch products and render on shop page. Create checkout sessions.
async function fetchProducts() {
  const el = document.getElementById('products');
  if (!el) return;
  const res = await fetch('/api/products');
  const products = await res.json();
  el.innerHTML = '';
  products.forEach(p => {
    const div = document.createElement('div');
    div.className = 'product-card';
    div.innerHTML = `<h4>${escapeHtml(p.name)}</h4>
      <p>${escapeHtml(p.description || '')}</p>
      <p><strong>${formatGhs(p.price_cents)}</strong></p>
      <p><input placeholder="Your email (for code)" id="email-${p.id}" /></p>
      <p><button onclick="buy(${p.id})">Buy</button></p>`;
    el.appendChild(div);
  });
}

function formatGhs(cents) {
  const ghc = (cents / 100).toFixed(2);
  return `GHS ${ghc}`;
}

function escapeHtml(str) {
  return String(str||'').replace(/[&<>"']/g, function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]});
}

async function buy(productId) {
  const email = document.getElementById('email-' + productId).value;
  if (!email || !/\S+@\S+\.\S+/.test(email)) {
    if (!confirm('No valid email provided. You may not receive the checker code. Continue?')) return;
  }
  const resp = await fetch('/api/create-checkout-session', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ productId, buyerEmail: email })
  });
  const data = await resp.json();
  if (data.error) return alert('Error: ' + data.error);
  // redirect to Stripe Checkout
  window.location = data.url;
}

// auto run on shop page
fetchProducts();
