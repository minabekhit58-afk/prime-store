const products = [
{ id: 1, name: "ساعة كلاسيك", category: "ساعات", price: 450, emoji: "⌚" },
{ id: 2, name: "محفظة رجالي", category: "محافظ", price: 250, emoji: "👛" },
{ id: 3, name: "إكسسوار أنيق", category: "إكسسوارات", price: 150, emoji: "✨" }
];

const money = value => "${value} جنيه";

function renderProducts() {
const container = document.querySelector(".products");
if (!container) return;

container.innerHTML = products.map(product => "<article class="product"> <div style="font-size:48px">${product.emoji}</div> <h3>${product.name}</h3> <p>${product.category}</p> <strong>${money(product.price)}</strong> <br> <button class="button" onclick="orderProduct(${product.id})"> اطلب عبر واتساب </button> </article>").join("");
}

function orderProduct(id) {
const product = products.find(item => item.id === id);
if (!product) return;

const message = "مرحبًا PRIME STORE، أريد طلب:\n${product.name}\nالسعر: ${money(product.price)}";
window.open(
"https://wa.me/201206770572?text=${encodeURIComponent(message)}",
"_blank"
);
}

document.addEventListener("DOMContentLoaded", renderProducts);
