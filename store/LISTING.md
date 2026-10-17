# Публикация в Chrome Web Store

Всё, что просит форма [Developer Dashboard](https://chrome.google.com/webstore/devconsole),
по порядку её вкладок. Тексты для полей — готовые, их можно вставлять как есть.

## Перед первой публикацией

- [ ] Аккаунт разработчика Chrome Web Store (разовый взнос $5) и включённая
      двухэтапная аутентификация Google — без неё загрузка не принимается.
- [ ] В `store/PRIVACY.md` вместо `<CONTACT EMAIL …>` указан контактный email.
- [ ] Политика конфиденциальности опубликована по публичному адресу (GitHub
      Pages, gist, страница на вашем домене) — в форму идёт ссылка, не файл.
- [ ] `npm run e2e` пройден против живого сервера (см. README).
- [ ] `./build-dist.sh patch` (или `minor`) — версия выше опубликованной,
      пакет `dist/elfalingo-extension-<версия>.zip`.

## Package

Загрузить `dist/elfalingo-extension-<версия>.zip`. Название, описание и
иконка подтянутся из манифеста и `_locales/`.

## Store listing

**Category:** Education · **Language:** English (по умолчанию) + Russian

### Description — English

```
Add German words to your ElfaLingo deck straight from any web page.

Select a word, right-click it and choose “Add to ElfaLingo”. The word joins
your queue and ElfaLingo builds the card for it — translation, pronunciation,
examples — exactly as if you had typed it in the app.

• Several words separated by commas are added one by one.
• Quotes, punctuation and line breaks caught in the selection are cleaned up.
• The toolbar icon tells you what happened: ✓ sent, = already in your deck,
  × not a word, ! no connection or sign-in needed.
• Offline? Words are kept and sent automatically once the server is back.

The extension works with your own ElfaLingo server: enter its address and
your account on the settings page. The password is never stored; you choose
whether the session is remembered or forgotten when the browser closes.
The extension talks to that one server only and sends it nothing but the
words you choose to add.
```

### Description — Russian

```
Добавляйте немецкие слова в колоду ElfaLingo прямо с любой страницы.

Выделите слово, нажмите правую кнопку мыши и выберите «Добавить в ElfaLingo».
Слово встаёт в очередь, и ElfaLingo собирает для него карточку — перевод,
произношение, примеры, — как будто вы набрали его в приложении.

• Несколько слов через запятую добавляются по одному.
• Кавычки, знаки препинания и переносы строк, попавшие в выделение, убираются.
• Значок на панели показывает, что произошло: ✓ — отправлено, = — уже в колоде,
  × — не слово, ! — нет связи или нужно войти.
• Нет сети? Слова сохраняются и отправляются сами, когда сервер снова доступен.

Расширение работает с вашим сервером ElfaLingo: укажите его адрес и аккаунт
на странице настроек. Пароль не сохраняется; запоминать ли сессию или забывать
её при закрытии браузера — выбираете вы. Расширение обращается только к этому
серверу и отправляет ему только те слова, которые вы добавили.
```

### Graphic assets

| Поле | Файл |
|---|---|
| Store icon (128×128) | `store/icon-128.png` |
| Screenshots (1280×800) | `store/screenshot-1280x800-en.png`, `-ru.png` для русской локали |
| Small promo tile (440×280) | `store/promo-440x280-en.png`, `-ru.png` |

Картинки пересобираются командой `npm run store-images`. Стору нужен хотя бы
один скриншот; лучше добавить второй, живой — с контекстным меню над
выделенным словом и значком «✓». Автоматически его не снять (меню Chrome
нативное): откройте любую немецкую статью, выделите слово, правый клик, и
сделайте снимок окна (на macOS — ⇧⌘4, затем пробел), обрезав до 1280×800.

## Privacy practices

**Single purpose:**

```
Adds a word the user selects on a web page to the user's deck on their own
ElfaLingo language-learning server, via the right-click menu.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| `contextMenus` | Shows the “Add to ElfaLingo” item over selected text — the extension's only feature. |
| `storage` | Keeps the server address, the session tokens (only if the user chooses “Remember sign-in”, otherwise session storage) and words waiting to be sent while offline. |
| `alarms` | Every 5 minutes checks whether the user's server is reachable, to show it on the icon and to send words that waited for the connection. |
| Host permissions (optional: `https://*/*`, `http://*/*`) | ElfaLingo is self-hosted, so the server address is entered by the user. The extension requests access to that one origin at sign-in, via Chrome's permission prompt, and gives it up on sign-out. No access is requested to any other site. |

**Remote code:** No, I am not using remote code.

**Data usage** — отметить:

- [x] Authentication information — email, пароль (только для входа), токены сессии.
- [x] Website content — выделенный текст, который пользователь сам отправил.

Остальные категории не отмечать. Все три сертификации — отметить
(не продаются третьим лицам; не используются для целей, не связанных с
единственным назначением; не используются для оценки кредитоспособности).

**Privacy policy URL:** публичная ссылка на `store/PRIVACY.md`.

## Distribution

- **Public** — расширение находится поиском в сторе.
- **Unlisted** — только по прямой ссылке. Разумно, если ElfaLingo — личный
  сервер: пользоваться расширением всё равно может только тот, у кого есть
  аккаунт.

После «Submit for review» проверка обычно занимает от нескольких дней до
пары недель; расширения с правами на хосты иногда проверяются дольше.
