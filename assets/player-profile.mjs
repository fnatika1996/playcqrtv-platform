const dateLocale=()=>window.CQRTVI18n?.locale==="en"?"en-US":window.CQRTVI18n?.locale==="ro"?"ro-RO":"ru-RU";
const roleLabels={rifler:"Стрелок",entry:"Энтри",support:"Поддержка",awper:"AWP-игрок",igl:"IGL",lurker:"Луркер",anchor:"Анкор",flex:"Флекс"};
function countryFlag(code){const value=String(code||"").toUpperCase();if(!/^[A-Z]{2}$/.test(value))return "—";return [...value].map(letter=>String.fromCodePoint(letter.charCodeAt(0)+127397)).join("")}
export function bindPlayerProfile(document,session,fetchImpl=globalThis.fetch){
  const byId=id=>document.getElementById(id),loading=byId("profile-loading"),guest=byId("profile-guest"),content=byId("profile-content");
  const menuButton=byId("profile-menu-toggle"),mobileMenu=byId("profile-mobile-navigation"),dialog=byId("nickname-dialog");
  const editButton=byId("profile-edit-btn"),closeButton=byId("nickname-dialog-close"),current=byId("nickname-current");
  const form=byId("nickname-form"),input=byId("nickname-change-input"),status=byId("nickname-change-status"),save=form.querySelector('[type="submit"]');
  let user=null,blocked=true;
  const links=[...document.querySelectorAll("[data-profile-section]")];
  function render(next){
    user=next&&typeof next.nickname==="string"?next:null;
    loading.hidden=true;guest.hidden=Boolean(user);content.hidden=!user;
    document.body.dataset.accountState=user?"authenticated":"guest";
    if(!user){const networkError=byId("auth-header-status").textContent.includes("Не удалось проверить аккаунт");byId("profile-guest-title").textContent=networkError?"Не удалось загрузить профиль":"Войдите, чтобы открыть профиль";byId("profile-guest-description").textContent=networkError?"Проверьте подключение и обновите страницу.":"Данные профиля доступны только владельцу аккаунта CQRTV.";byId("profile-guest-signup").hidden=networkError;return;}
    const nickname=user.nickname.trim(),country=String(user.country||"").toUpperCase();
    byId("profile-title").setAttribute("aria-label","Профиль игрока "+nickname);
    byId("profile-country-code").textContent=country||"—";
    const flag=countryFlag(country);byId("about-country-flag").textContent=flag;
    byId("about-country-flag").setAttribute("aria-label",country?"Флаг страны "+country:"Страна не указана");
    byId("about-country-code").textContent=country||"—";
    byId("about-primary-role").textContent=roleLabels[user.primary_role]||"—";
    const secondary=(Array.isArray(user.secondary_roles)?user.secondary_roles:[]).map(role=>roleLabels[role]).filter(Boolean);
    byId("about-secondary-roles").textContent=secondary.join(" · ")||"—";
  }
  function closeMenu(){mobileMenu.hidden=true;menuButton.setAttribute("aria-expanded","false")}
  menuButton.addEventListener("click",()=>{const opening=mobileMenu.hidden;mobileMenu.hidden=!opening;menuButton.setAttribute("aria-expanded",String(opening));if(opening)mobileMenu.querySelector("a")?.focus()});
  mobileMenu.querySelectorAll("a").forEach(link=>link.addEventListener("click",closeMenu));
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!mobileMenu.hidden){closeMenu();menuButton.focus()}});
  function setCurrentSection(){const hash=location.hash||"#overview";links.forEach(link=>{const active=link.getAttribute("href")===hash&&link.tagName==="A";link.classList.toggle("is-current",active);if(active)link.setAttribute("aria-current","page");else link.removeAttribute("aria-current")})}
  document.defaultView.addEventListener("hashchange",setCurrentSection);setCurrentSection();
  async function openNicknameEditor(){
    if(!user){location.assign("/auth.html");return}
    dialog.showModal();current.textContent="Проверяем аккаунт…";status.textContent="";input.disabled=true;input.value=user.nickname;blocked=true;save.disabled=true;let checked=false;
    try{
      const response=await fetchImpl("/api/auth/me",{cache:"no-store",credentials:"same-origin"}),data=await response.json();
      if(!response.ok||!data?.user){current.textContent="Не удалось проверить аккаунт. Войдите ещё раз.";return}
      user=data.user;input.value=user.nickname;current.textContent=window.CQRTVI18n?.t("Сейчас установлен ник: {nickname}",{nickname:user.nickname})||("Сейчас установлен ник: "+user.nickname);checked=true;
      const availableAt=user.nickname_available_at?new Date(user.nickname_available_at):null;
      if(availableAt&&availableAt>Date.now()){status.textContent=window.CQRTVI18n?.t("Бесплатная смена будет доступна {date}.",{date:availableAt.toLocaleDateString(dateLocale())})||("Бесплатная смена будет доступна "+availableAt.toLocaleDateString(dateLocale())+".");blocked=true}
      else{status.textContent="Бесплатная смена доступна.";blocked=false}
    }catch{current.textContent="Не удалось загрузить аккаунт. Попробуйте ещё раз."}
    finally{input.disabled=!checked;save.disabled=blocked}
  }
  editButton.addEventListener("click",openNicknameEditor);
  document.querySelectorAll("[data-open-nickname-editor]").forEach(button=>button.addEventListener("click",openNicknameEditor));
  closeButton.addEventListener("click",()=>dialog.close());
  dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close()});
  form.addEventListener("submit",async event=>{
    event.preventDefault();if(!form.reportValidity()||blocked||save.disabled)return;
    blocked=true;save.disabled=true;status.textContent="Сохраняем никнейм…";
    try{
      const response=await fetchImpl("/api/account/nickname",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({nickname:input.value})}),data=await response.json();
      status.textContent=data.message||data.error||"Не удалось изменить никнейм.";
      if(response.ok&&data.nickname){
        user={...user,nickname:data.nickname,nickname_available_at:data.nicknameAvailableAt||null};
        const initial=[...data.nickname.trim()][0]?.toLocaleUpperCase("ru")||"";
        byId("profile-nickname").textContent=data.nickname;byId("profile-avatar-letter").textContent=initial;
        byId("header-user-nickname").textContent=data.nickname;byId("header-avatar-initial").textContent=initial;
        current.textContent=window.CQRTVI18n?.t("Сейчас установлен ник: {nickname}",{nickname:data.nickname})||("Сейчас установлен ник: "+data.nickname);
        if(data.nicknameAvailableAt)status.textContent=window.CQRTVI18n?.t("Ник изменён. Бесплатная смена будет доступна {date}.",{date:new Date(data.nicknameAvailableAt).toLocaleDateString(dateLocale())})||("Ник изменён. Бесплатная смена будет доступна "+new Date(data.nicknameAvailableAt).toLocaleDateString(dateLocale())+".");
      }else if(data.nicknameAvailableAt){status.textContent=(data.error||"Никнейм пока нельзя изменить.")+" Следующая смена: "+new Date(data.nicknameAvailableAt).toLocaleDateString(dateLocale())+".";blocked=true}
      else blocked=false;
    }catch{status.textContent="Не удалось связаться с сервером. Попробуйте позже.";blocked=false}
    finally{save.disabled=blocked}
  });
  session.onSessionChange(render);
  return{render,closeMenu};
}
