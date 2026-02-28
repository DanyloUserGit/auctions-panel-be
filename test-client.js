const { io } = require("socket.io-client");

// Вкажи порт, на якому крутиться твій Main API (зазвичай 3000)
const socket = io("http://localhost:8000"); 

socket.on("connect", () => {
  console.log("✅ Підключено до WebSocket! ID:", socket.id);
  
  // Симулюємо запит від React-клієнта
  // УВАГА: Заміни userId та auctionId на реальні ID з твоєї локальної бази даних Prisma!
  const payload = {
    userId: "139496cf-384d-4b62-8745-1b70729797b8", 
    auctionId: "739e7c74-f41e-4ac3-834b-0b1d4043110d",
    width: 1280,
    height: 720
  };

  console.log("Відправляю 'join_auction'...", payload);
  socket.emit("join_auction", payload);
});

socket.on("session_ready", (data) => {
  console.log("🎉 СЕСІЯ УСПІШНО СТВОРЕНА! Відповідь сервера:", data);
  // Після цього ти маєш побачити в логах Worker-а (Термінал 2), 
  // що Playwright почав запускатися!
});

socket.on("error", (err) => {
  console.error("❌ Помилка від сервера:", err);
});

socket.on("disconnect", () => {
  console.log("Відключено від сервера");
});