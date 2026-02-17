import pkg from '@maxhub/max-bot-api';
const { Bot, FileAttachment } = pkg;
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Проверяем наличие токена
if (!process.env.BOT_TOKEN) {
  console.error('Ошибка: BOT_TOKEN не указан в .env файле');
  process.exit(1);
}

if (!process.env.CHANNEL_ID) {
  console.error('Ошибка: CHANNEL_ID не указан в .env файле');
  process.exit(1);
}

const CHANNEL_ID = process.env.CHANNEL_ID;
const CHECKLIST_PATH = path.join(__dirname, 'checklist.pdf');

// Создаем экземпляр бота
const bot = new Bot(process.env.BOT_TOKEN);

// Файл для хранения пользователей
const USERS_FILE = path.join(__dirname, 'users.json');

// Загружаем пользователей из файла
function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      return new Set(data.users || []);
    }
  } catch (error) {
    console.error('Ошибка загрузки пользователей:', error);
  }
  return new Set();
}

// Сохраняем пользователей в файл
function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: Array.from(users) }, null, 2));
  } catch (error) {
    console.error('Ошибка сохранения пользователей:', error);
  }
}

// Хранилище для отслеживания пользователей, которым уже отправлен чеклист
const processedUsers = new Set();

// Хранилище всех пользователей бота (для рассылки) — загружаем из файла
const allUsers = loadUsers();
console.log('Загружено пользователей из базы:', allUsers.size);

// Хранилище активных чатов с менеджером
const activeManagerChats = new Map(); // userId -> managerId

// ID администратора/менеджера (замените на реальный ID)
const ADMIN_ID = process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID) : null;

// Флаг для отслеживания обработки пользователя (чтобы избежать дублирования)
const processingUsers = new Set();

// Функция проверки подписки на канал
async function isUserSubscribed(userId) {
  try {
    console.log(`Проверка подписки: channel_id=${CHANNEL_ID}, user_id=${userId}`);
    
    // Пробуем получить участников канала
    try {
      const membersResult = await bot.api.raw.get('chats/{chat_id}/members', {
        path: {
          chat_id: CHANNEL_ID
        }
      });
      console.log('Результат получения участников:', JSON.stringify(membersResult, null, 2));
      
      // Проверяем разные возможные структуры ответа
      const members = membersResult?.data?.members || membersResult?.members;
      
      if (members && Array.isArray(members)) {
        console.log('Ищем userId:', userId, 'тип:', typeof userId);
        console.log('Количество участников:', members.length);
        const isMember = members.some(member => member.user_id == userId);
        console.log('Пользователь найден в канале:', isMember);
        return isMember;
      } else {
        console.log('Структура ответа неожиданная, members не найден');
      }
    } catch (membersError) {
      console.log('Ошибка получения участников:', membersError.message);
    }
    
    return false;
  } catch (error) {
    console.log('Ошибка проверки подписки:', error.message);
    return false;
  }
}

// Функция для получения или загрузки PDF файла
async function getChecklistFileToken() {
  // Проверяем, есть ли уже сохраненный токен
  if (process.env.CHECKLIST_FILE_TOKEN) {
    return process.env.CHECKLIST_FILE_TOKEN;
  }

  // Если файла нет, возвращаем null
  if (!fs.existsSync(CHECKLIST_PATH)) {
    console.warn('Предупреждение: Файл checklist.pdf не найден. Пожалуйста, поместите PDF файл в папку проекта.');
    return null;
  }

  // Загружаем файл на сервер MAX
  try {
    const fileBuffer = fs.readFileSync(CHECKLIST_PATH);
    const uploadResult = await bot.api.uploadFile(fileBuffer, 'checklist.pdf');
    
    if (uploadResult && uploadResult.token) {
      console.log('Чеклист успешно загружен. Токен файла:', uploadResult.token);
      console.log('Сохраните этот токен в .env файл как CHECKLIST_FILE_TOKEN для повторного использования');
      return uploadResult.token;
    }
  } catch (error) {
    console.error('Ошибка при загрузке чеклиста:', error);
  }
  
  return null;
}

// Обработчик запуска бота (когда пользователь первый раз открывает бота)
bot.on('bot_started', async (ctx) => {
  const userId = ctx.user?.user_id || ctx.message?.sender?.user_id;
  console.log('bot_started userId:', userId);
  
  // Проверяем, не обрабатываем ли уже этого пользователя
  if (!userId || processingUsers.has(userId)) {
    return;
  }
  
  processingUsers.add(userId);
  
  // Сохраняем пользователя в базу для рассылок
  if (!allUsers.has(userId)) {
    allUsers.add(userId);
    saveUsers(allUsers);
    console.log('Пользователь добавлен в базу. Всего пользователей:', allUsers.size);
  }
  
  // Всегда показываем главное меню
  await sendMainMenu(ctx);
  
  // Убираем из обрабатываемых через небольшую задержку
  setTimeout(() => processingUsers.delete(userId), 1000);
});

// Обработчик команды /start
bot.command('start', async (ctx) => {
  const userId = ctx.user?.user_id || ctx.message?.sender?.user_id;
  console.log('/start userId:', userId);
  
  // Проверяем, не обрабатываем ли уже этого пользователя
  if (!userId || processingUsers.has(userId)) {
    return;
  }
  
  processingUsers.add(userId);
  
  // Сохраняем пользователя в базу для рассылок
  if (!allUsers.has(userId)) {
    allUsers.add(userId);
    saveUsers(allUsers);
  }
  
  // Всегда показываем главное меню
  await sendMainMenu(ctx);
  
  // Убираем из обрабатываемых через небольшую задержку
  setTimeout(() => processingUsers.delete(userId), 1000);
});

// Обработчик кнопки "Получить чеклист"
bot.action('get_checklist', async (ctx) => {
  const userId = ctx.update?.callback?.user?.user_id;
  console.log('get_checklist user_id:', userId);
  
  // Проверяем, не получал ли уже чеклист
  if (processedUsers.has(userId)) {
    await ctx.reply('✅ Вы уже получили чеклист ранее!');
    await showMenuAgain(ctx);
    return;
  }
  
  // Проверяем подписку на канал
  const isSubscribed = await isUserSubscribed(userId);
  
  if (isSubscribed) {
    await sendChecklist(ctx, userId);
    await showMenuAgain(ctx, '🎉 Чеклист отправлен!');
  } else {
    // Просим подписаться
    const buttons = [
      [
        {
          type: 'link',
          text: '📢 Подписаться на канал',
          url: `https://max.ru/${process.env.CHANNEL_NAME || 'channel'}`
        }
      ],
      [
        {
          type: 'callback',
          text: '✅ Я уже подписался',
          payload: 'check_subscription'
        }
      ],
      [
        {
          type: 'callback',
          text: '📋 Главное меню',
          payload: 'show_menu'
        }
      ]
    ];
    
    await ctx.reply(
      '🎁 Для получения чеклиста "Работа с подрядчиками" подпишитесь на наш канал!\n\n' +
      'После подписки нажмите "Я уже подписался".',
      { attachments: [{ type: 'inline_keyboard', payload: { buttons: buttons } }] }
    );
  }
});

// Обработчик кнопки "Я подписался" (проверка подписки)
bot.action('check_subscription', async (ctx) => {
  const userId = ctx.update?.callback?.user?.user_id;
  console.log('check_subscription user_id:', userId);
  
  // Проверяем подписку
  const isSubscribed = await isUserSubscribed(userId);
  
  if (isSubscribed) {
    await sendChecklist(ctx, userId);
    await showMenuAgain(ctx, '🎉 Подписка подтверждена! Чеклист отправлен.');
  } else {
    const buttons = [
      [
        {
          type: 'link',
          text: '📢 Подписаться на канал',
          url: `https://max.ru/${process.env.CHANNEL_NAME || 'channel'}`
        }
      ],
      [
        {
          type: 'callback',
          text: '✅ Я уже подписался',
          payload: 'check_subscription'
        }
      ],
      [
        {
          type: 'callback',
          text: '📋 Главное меню',
          payload: 'show_menu'
        }
      ]
    ];
    
    await ctx.reply(
      '❌ Подписка не найдена.\n\n' +
      'Пожалуйста, подпишитесь на канал и нажмите "Я уже подписался".',
      { attachments: [{ type: 'inline_keyboard', payload: { buttons: buttons } }] }
    );
  }
});

// Обработчик кнопки "Главное меню"
bot.action('show_menu', async (ctx) => {
  await sendMainMenu(ctx);
});

// Обработчик кнопки "Заказать услуги"
bot.action('order_services', async (ctx) => {
  const userId = ctx.update?.callback?.user?.user_id;
  
  // Активируем чат с менеджером для заказа услуг
  if (ADMIN_ID) {
    activeManagerChats.set(userId, ADMIN_ID);
    
    await ctx.reply(
      '📋 *Заказ услуг*\n\n' +
      'Опишите, какие услуги вас интересуют:\n' +
      '• Инвентаризация объектов\n' +
      '• Оцифровка инфраструктуры\n' +
      '• Создание ГИС-системы\n' +
      '• Другое\n\n' +
      'Напишите ваш запрос, и менеджер свяжется с вами.',
      {
        format: 'markdown',
        attachments: [{
          type: 'inline_keyboard',
          payload: {
            buttons: [
              [{
                type: 'callback',
                text: '❌ Отменить',
                payload: 'end_chat'
              }],
              [{
                type: 'callback',
                text: '📋 Главное меню',
                payload: 'show_menu'
              }]
            ]
          }
        }]
      }
    );
    
    // Уведомляем менеджера
    try {
      await bot.api.sendMessageToUser(ADMIN_ID,
        `🔔 *Новый запрос на услуги*\n\n` +
        `Пользователь ID: ${userId}\n` +
        `Готовится заказ услуг.`,
        { format: 'markdown' }
      );
    } catch (error) {
      console.error('Ошибка уведомления менеджера:', error);
    }
  } else {
    await ctx.reply('❌ В данный момент заказ услуг недоступен. Попробуйте позже.');
    await showMenuAgain(ctx);
  }
});

// Функция отправки главного меню
async function sendMainMenu(ctx) {
  const buttons = [
    [
      {
        type: 'callback',
        text: '📄 Получить чеклист',
        payload: 'get_checklist'
      }
    ],
    [
      {
        type: 'callback',
        text: '💬 Написать в техподдержку',
        payload: 'ask_question'
      }
    ],
    [
      {
        type: 'link',
        text: '🔐 Войти в сервис',
        url: 'https://единаясреда.рф/login'
      }
    ],
    [
      {
        type: 'link',
        text: '🌐 Перейти на сайт',
        url: 'https://единаясреда.рф'
      }
    ],
    [
      {
        type: 'callback',
        text: '📋 Заказать услуги',
        payload: 'order_services'
      }
    ]
  ];
  
  await ctx.reply(
    '👋 Добро пожаловать в Единую Среду!\n\n' +
    'Выберите действие:',
    {
      format: 'markdown',
      attachments: [{
        type: 'inline_keyboard',
        payload: { buttons: buttons }
      }]
    }
  );
}

// Функция для повторного показа меню
async function showMenuAgain(ctx, message = 'Что-нибудь еще?') {
  await ctx.reply(message, {
    format: 'markdown',
    attachments: [{
      type: 'inline_keyboard',
      payload: {
        buttons: [[{
          type: 'callback',
          text: '📋 Главное меню',
          payload: 'show_menu'
        }]]
      }
    }]
  });
}

// Функция отправки чеклиста
async function sendChecklist(ctx, userId) {
  // Если чеклист уже отправляли — просто показываем меню
  if (processedUsers.has(userId)) {
    await sendMainMenu(ctx);
    return;
  }
  
  const fileToken = await getChecklistFileToken();
  
  if (fileToken) {
    const fileAttachment = new FileAttachment({ token: fileToken });
    
    await ctx.reply(
      '🎉 Спасибо за подписку!\n\n' +
      'Вот ваш чеклист "Работа с подрядчиками":',
      { attachments: [fileAttachment.toJson()] }
    );
    
    processedUsers.add(userId);
  } else {
    await ctx.reply(
      '🎉 Спасибо за подписку!\n\n' +
      'К сожалению, в данный момент чеклист временно недоступен. ' +
      'Пожалуйста, попробуйте позже или свяжитесь с администратором.'
    );
    processedUsers.add(userId);
  }
  
  // Отправляем меню с дополнительными опциями
  await sendMainMenu(ctx);
}

// Команда для админа: рассылка сообщения всем пользователям
bot.command('broadcast', async (ctx) => {
  const userId = ctx.user?.user_id || ctx.message?.sender?.user_id;
  
  // Проверяем, что команду вызвал админ
  if (userId !== ADMIN_ID) {
    await ctx.reply('❌ У вас нет прав для выполнения этой команды.');
    return;
  }
  
  const text = ctx.message?.body?.text?.replace('/broadcast', '').trim();
  
  if (!text) {
    await ctx.reply('❌ Укажите текст сообщения после команды /broadcast\n\nПример: /broadcast Привет! Новая акция...');
    return;
  }
  
  if (allUsers.size === 0) {
    await ctx.reply('❌ Список пользователей пуст. Никто еще не запускал бота.');
    return;
  }
  
  await ctx.reply(`📤 Начинаю рассылку ${allUsers.size} пользователям...`);
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const targetUserId of allUsers) {
    try {
      await bot.api.sendMessageToUser(targetUserId, 
        '📢 *Сообщение от команды Единая Среда*\n\n' + text,
        { format: 'markdown' }
      );
      successCount++;
    } catch (error) {
      console.error(`Ошибка отправки пользователю ${targetUserId}:`, error.message);
      errorCount++;
    }
  }
  
  await ctx.reply(`✅ Рассылка завершена!\n\n📤 Успешно: ${successCount}\n❌ Ошибок: ${errorCount}`);
});

// Команда для админа: показать статистику
bot.command('stats', async (ctx) => {
  const userId = ctx.user?.user_id || ctx.message?.sender?.user_id;
  
  if (userId !== ADMIN_ID) {
    await ctx.reply('❌ У вас нет прав для выполнения этой команды.');
    return;
  }
  
  await ctx.reply(
    `📊 *Статистика бота*\n\n` +
    `👥 Всего пользователей: ${allUsers.size}\n` +
    `✅ Получили чеклист: ${processedUsers.size}\n` +
    `💬 Активных чатов с менеджером: ${activeManagerChats.size}`,
    { format: 'markdown' }
  );
});

// Обработчик кнопки "Написать в техподдержку"
bot.action('ask_question', async (ctx) => {
  const userId = ctx.update?.callback?.user?.user_id;
  
  if (!ADMIN_ID) {
    await ctx.reply('❌ К сожалению, в данный момент нет доступных менеджеров. Попробуйте позже.');
    await showMenuAgain(ctx);
    return;
  }
  
  // Активируем чат с менеджером
  activeManagerChats.set(userId, ADMIN_ID);
  
  // Уведомляем пользователя
  await ctx.reply(
    '💬 *Чат с техподдержкой активирован*\n\n' +
    'Напишите ваш вопрос, и мы ответим вам в ближайшее время.\n\n' +
    'Для завершения диалога нажмите кнопку ниже.',
    {
      format: 'markdown',
      attachments: [{
        type: 'inline_keyboard',
        payload: {
          buttons: [
            [{
              type: 'callback',
              text: '❌ Завершить диалог',
              payload: 'end_chat'
            }],
            [{
              type: 'callback',
              text: '📋 Главное меню',
              payload: 'show_menu'
            }]
          ]
        }
      }]
    }
  );
  
  // Уведомляем менеджера
  try {
    await bot.api.sendMessageToUser(ADMIN_ID,
      `🔔 *Новый запрос в техподдержку*\n\n` +
      `Пользователь ID: ${userId}\n` +
      `Начат диалог. Ожидает ответа...`,
      { format: 'markdown' }
    );
  } catch (error) {
    console.error('Ошибка уведомления менеджера:', error);
  }
});

// Обработчик завершения чата
bot.action('end_chat', async (ctx) => {
  const userId = ctx.update?.callback?.user?.user_id;
  
  if (activeManagerChats.has(userId)) {
    const managerId = activeManagerChats.get(userId);
    activeManagerChats.delete(userId);
    
    await ctx.reply('✅ Диалог завершен. Спасибо за обращение!');
    await showMenuAgain(ctx);
    
    // Уведомляем менеджера
    try {
      await bot.api.sendMessageToUser(managerId,
        `🔔 Пользователь ${userId} завершил диалог.`
      );
    } catch (error) {
      console.error('Ошибка уведомления менеджера:', error);
    }
  } else {
    await showMenuAgain(ctx);
  }
});

// Обработчик пересылки сообщений между пользователем и менеджером
bot.on('message_created', async (ctx) => {
  const senderId = ctx.message?.sender?.user_id;
  const text = ctx.message?.body?.text;
  
  console.log('message_created:', { senderId, text: text?.substring(0, 50), ADMIN_ID });
  console.log('activeManagerChats:', Array.from(activeManagerChats.entries()));
  
  // Игнорируем команды
  if (text?.startsWith('/')) return;
  
  // Если отправитель — пользователь с активным чатом
  if (activeManagerChats.has(senderId)) {
    const managerId = activeManagerChats.get(senderId);
    console.log(`Пересылаем сообщение от ${senderId} к менеджеру ${managerId}`);
    
    // Пересылаем сообщение менеджеру
    try {
      await bot.api.sendMessageToUser(managerId,
        `💬 *Сообщение от пользователя ${senderId}*:\n\n${text}`,
        { format: 'markdown' }
      );
      console.log('Сообщение переслано менеджеру успешно');
    } catch (error) {
      console.error('Ошибка пересылки менеджеру:', error);
    }
    return;
  }
  
  // Если отправитель — менеджер, и он отвечает пользователю
  if (senderId === ADMIN_ID) {
    console.log('Сообщение от админа, ищем кому отвечать...');
    
    const activeChats = Array.from(activeManagerChats.entries());
    console.log('Активные чаты:', activeChats);
    
    // Проверяем, не указал ли админ ID пользователя в начале сообщения
    const match = text?.match(/^(\d+)\s+(.+)$/s);
    
    if (match) {
      // Админ указал ID пользователя
      const targetUserId = parseInt(match[1]);
      const messageText = match[2];
      
      if (activeManagerChats.has(targetUserId)) {
        try {
          await bot.api.sendMessageToUser(targetUserId,
            `💬 *Ответ от менеджера*:\n\n${messageText}`,
            { format: 'markdown' }
          );
          await bot.api.sendMessageToUser(ADMIN_ID, `✅ Ответ отправлен пользователю ${targetUserId}`);
          console.log(`Ответ отправлен пользователю ${targetUserId}`);
        } catch (error) {
          console.error('Ошибка отправки пользователю:', error);
        }
      } else {
        await bot.api.sendMessageToUser(ADMIN_ID, `❌ Пользователь ${targetUserId} не в активном чате`);
      }
      return;
    }
    
    // Если активных чатов один — отправляем ему
    if (activeChats.length === 1) {
      const [userId, managerId] = activeChats[0];
      console.log(`Отправляем ответ пользователю ${userId}`);
      
      try {
        await bot.api.sendMessageToUser(userId,
          `💬 *Ответ от менеджера*:\n\n${text}`,
          { format: 'markdown' }
        );
        console.log('Ответ отправлен пользователю успешно');
      } catch (error) {
        console.error('Ошибка отправки пользователю:', error);
      }
    } else if (activeChats.length > 1) {
      // Если несколько чатов, просим указать ID
      await bot.api.sendMessageToUser(ADMIN_ID,
        `⚠️ У вас ${activeChats.length} активных чатов.\n` +
        `Активные пользователи: ${activeChats.map(([id]) => id).join(', ')}\n\n` +
        `Чтобы ответить конкретному пользователю, начните сообщение с ID:\n` +
        `Например: "12345678 Ваш ответ"`
      );
    } else {
      console.log('Нет активных чатов для ответа');
    }
  }
});

// Обработчик ошибок
bot.catch((error) => {
  console.error('Произошла ошибка:', error);
});

// Запускаем бота
console.log('Запуск бота...');
bot.start();
console.log('Бот успешно запущен!');
