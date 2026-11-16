# CQRTV icon mapping — approved A+ implementation

The production manifest keeps the existing 38 URL aliases for compatibility. The safe icon build reads only curated files from `Icon Play CQRTV.rar`, sanitizes vector elements and attributes through an allowlist, and emits both aliases and `admin-icon-sprite.svg`. The sprite maps the first source paint to `--icon-primary` and subsequent source paints to `--icon-secondary`; screens assign state tokens through CSS inheritance. Public/admin pages use same-origin SVG `<use>` references. No CSS filter is used to recolor an icon.

| Action | Production alias | Archive source | Usage / distinction |
| --- | --- | --- | --- |
| Dashboard overview | `dashboard.svg` | `Settings Fine Tuning/Widget--playcqrtv.svg` | Overview navigation; chart remains separate. |
| Users / team | `users.svg`, `users-group-two.svg` | `Users/Users-Group-Rounded--playcqrtv.svg`, `Users/Users-Group-Two-Rounded--playcqrtv.svg` | User list and community count. |
| Profile | `user.svg`, `user-circle.svg` | `Users/User--playcqrtv.svg`, `Users/User-Circle--playcqrtv.svg` | Individual account identity. |
| Settings | `settings.svg` | `Settings Fine Tuning/Settings-Minimalistic--playcqrtv.svg` | Site settings. |
| Search | `search.svg` | `Search/Magnifer--playcqrtv.svg` | Search, distinct from filtering. |
| Notifications | `bell.svg` | `Notifications/Bell--playcqrtv.svg` | Notification entry point; does not imply delivery is active. |
| Login | `login.svg` | `Arrows Action/Login--playcqrtv.svg` | Sign into an account. |
| Logout / end session | `logout.svg` | `Arrows Action/Logout-6--playcqrtv.svg` | Door-and-arrow icon selected for the action that ends the admin session. |
| Exit / leave a view | No logout alias | `Exit` remains a separate archive meaning | Do not use Exit as a substitute for Logout or Login. |
| Email / verification | `mail.svg`, `letter-open.svg` | `Messages Conversation/Letter--playcqrtv.svg`, `Messages Conversation/Letter-Opened--playcqrtv.svg` | Email entry and confirmed state; text remains the status. |
| Password / visibility | `lock.svg`, `eye.svg`, `eye-closed.svg` | `Security/Lock-Keyhole-Minimalistic--playcqrtv.svg`, `Security/Eye--playcqrtv.svg`, `Security/Eye-Closed--playcqrtv.svg` | Lock means credential; eye pair follows the visible/hidden state. |
| Protected session | `shield.svg`, `shield-user.svg`, `shield-warning.svg` | `Security/Shield-Check--playcqrtv.svg`, `Security/Shield-User--playcqrtv.svg`, `Security/Shield-Warning--playcqrtv.svg` | Session, security identity, and warning remain distinct. |
| CS2 / matches | `gamepad.svg`, `gamepad-minimalistic.svg`, `play.svg`, `ranking.svg` | `Electronic Devices/Gamepad--playcqrtv.svg`, `Electronic Devices/Gamepad-Minimalistic--playcqrtv.svg`, `Video Audio Sound/Play--playcqrtv.svg`, `Sports/Ranking--playcqrtv.svg` | Game area, start action, and ranking have separate meanings. |
| Messages / social links | `chat.svg`, `home.svg` | `Messages Conversation/Chat-Round--playcqrtv.svg`, `Essentional UI/Home--playcqrtv.svg` | Conversation vs. home; branded provider marks remain provider-specific. |
| Edit / reversible suspension | `edit.svg`, `user-block.svg` | `Messages Conversation/Pen--playcqrtv.svg`, `Users/User-Block--playcqrtv.svg` | Editing vs. reversible suspension; suspension is not deletion. |
| Upload / reorder / navigation | `upload.svg`, `reorder.svg`, `arrow-left.svg`, `close.svg` | `Arrows Action/Upload--playcqrtv.svg`, `Arrows Action/R