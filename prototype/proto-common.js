/* 独立原型页共享：轻量 toast + 返回矩阵入口。
   评审用，不参与生产。 */
(function () {
  if (window.pt) return;
  const box = document.createElement("div");
  box.className = "pt-toasts";
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(box));

  window.pt = function (msg, type) {
    if (!box.isConnected) document.body.appendChild(box);
    const el = document.createElement("div");
    el.className = "pt-toast" + (type === "error" ? " error" : "");
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  };

  document.addEventListener("DOMContentLoaded", () => {
    if (document.querySelector(".proto-home")) return;
    const a = document.createElement("a");
    a.className = "proto-home";
    a.href = "matrix.html";
    a.textContent = "← 原型矩阵";
    a.title = "返回原型矩阵";
    document.body.appendChild(a);
  });
})();
