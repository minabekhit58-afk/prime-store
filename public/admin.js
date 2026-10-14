const loginForm = document.getElementById("loginForm");
const loginSection = document.getElementById("login");
const dashboard = document.getElementById("dashboard");
const loginMessage = document.getElementById("loginMessage");
const productForm = document.getElementById("productForm");
const productMessage = document.getElementById("productMessage");
const productsList = document.getElementById("productsList");
const ordersList = document.getElementById("ordersList");
const dashboardMessage = document.getElementById("dashboardMessage");
const logoutButton = document.getElementById("logoutButton");

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "حصل خطأ، حاول تاني.");
  return data;
}

function showDashboard(loggedIn) {
  loginSection.hidden = loggedIn;
  dashboard.hidden = !loggedIn;
}

async function checkLogin() {
  try {
    const data = await api("/api/admin/me");
    showDashboard(data.isAdmin);
    if (data.isAdmin) await loadDashboard();
  } catch {
    showDashboard(false);
  }
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  loginMessage.textContent = "جاري تسجيل الدخول...";
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        password: document.getElementById("password").value
      })
    });
    loginForm.reset();
    loginMessage.textContent = "";
    showDashboard(true);
    await loadDashboard();
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    await api("/api/admin/logout", { method: "POST", body: "{}" });
  } finally {
    showDashboard(false);
  }
});

productForm.addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(productForm);
  const product = Object.fromEntries(form.entries());
  product.price = Number(product.price);
  product.stock = Number(product.stock);
  productMessage.textContent = "جاري إضافة المنتج...";

  try {
    await api("/api/admin/products", {
      method: "POST",
      body: JSON.stringify(product)
    });
    productForm.reset();
    productMessage.textContent = "تمت إضافة المنتج بنجاح.";
    await loadProducts();
  } catch (error) {
    productMessage.textContent = error.message;
  }
});

async function loadProducts() {
  const products = await api("/api/admin/products");
  productsList.replaceChildren();

  if (!products.length) {
    productsList.textContent = "لسه مفيش منتجات.";
    return;
  }

  products.forEach(product => {
    const card = document.createElement("article");
    const title = document.createElement("h3");
    title.textContent = product.name;

    const details = document.createElement("p");
    details.textContent =
      `السعر: ${product.price} جنيه | الكمية: ${product.stock} | ${
        product.is_active ? "ظاهر في المتجر" : "مخفي"
      }`;

    const editButton = document.createElement("button");
    editButton.textContent = "تعديل السعر والكمية";
    editButton.type = "button";
    editButton.addEventListener("click", async () => {
      const price = prompt("اكتب السعر الجديد:", product.price);
      if (price === null) return;
      const stock = prompt("اكتب الكمية الجديدة:", product.stock);
      if (stock === null) return;

      try {
        await api(`/api/admin/products/${product.id}`, {
          method: "PATCH",
          body: JSON.stringify({ price: Number(price), stock: Number(stock) })
        });
        await loadProducts();
      } catch (error) {
        alert(error.message);
      }
    });

    const visibilityButton = document.createElement("button");
    visibilityButton.type = "button";
    visibilityButton.textContent = product.is_active ? "إخفاء المنتج" : "إظهار المنتج";
    visibilityButton.addEventListener("click", async () => {
      try {
        await api(`/api/admin/products/${product.id}`, {
          method: "PATCH",
          body: JSON.stringify({ is_active: !product.is_active })
        });
        await loadProducts();
      } catch (error) {
        alert(error.message);
      }
    });

    card.append(title, details, editButton, visibilityButton);
    productsList.append(card);
  });
}

async function loadOrders() {
  const orders = await api("/api/admin/orders");
  ordersList.replaceChildren();

  if (!orders.length) {
    ordersList.textContent = "لسه مفيش طلبات.";
    return;
  }

  orders.forEach(order => {
    const card = document.createElement("article");
    const title = document.createElement("h3");
    title.textContent = `طلب رقم ${order.id}`;

    const details = document.createElement("p");
    details.textContent =
      `العميل: ${order.customer_name} | الهاتف: ${order.phone} | ` +
      `العنوان: ${order.address} | الإجمالي: ${order.total} جنيه`;

    const items = document.createElement("p");
    items.textContent = (order.order_items || [])
      .map(item => `${item.product_name} × ${item.quantity}`)
      .join("، ");

    const status = document.createElement("select");
    [
      ["new", "جديد"],
      ["confirmed", "تم التأكيد"],
      ["shipped", "تم الشحن"],
      ["completed", "مكتمل"],
      ["cancelled", "ملغي"]
    ].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      status.append(option);
    });
    status.value = order.status;

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.textContent = "حفظ حالة الطلب";
    saveButton.addEventListener("click", async () => {
      try {
        await api(`/api/admin/orders/${order.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: status.value })
        });
        dashboardMessage.textContent = `تم تحديث الطلب رقم ${order.id}.`;
      } catch (error) {
        dashboardMessage.textContent = error.message;
      }
    });

    card.append(title, details, items, status, saveButton);
    ordersList.append(card);
  });
}

async function loadDashboard() {
  try {
    await Promise.all([loadProducts(), loadOrders()]);
    dashboardMessage.textContent = "";
  } catch (error) {
    dashboardMessage.textContent = error.message;
  }
}

checkLogin();
