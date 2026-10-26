// A first Arabic spelling for an English name, to be checked by the person before it is printed.
// Common business words come from a small list; other words are spelled letter by letter.
// This is a suggestion only: names have no single correct Arabic spelling.
const WORDS: Record<string, string> = {
  mohammed: "محمد", muhammad: "محمد", mohamed: "محمد", mohammad: "محمد", ahmed: "أحمد", ahmad: "أحمد", ali: "علي", omar: "عمر", umar: "عمر", khalid: "خالد", khaled: "خالد",
  hassan: "حسن", hussain: "حسين", hussein: "حسين", ibrahim: "إبراهيم", yusuf: "يوسف", yousef: "يوسف", youssef: "يوسف", abdullah: "عبدالله", abdulla: "عبدالله", abdul: "عبد", abdel: "عبد",
  rahman: "الرحمن", rahim: "الرحيم", aziz: "العزيز", karim: "كريم", salem: "سالم", saleh: "صالح", said: "سعيد", saeed: "سعيد", sultan: "سلطان", rashid: "راشد", rashed: "راشد",
  mansoor: "منصور", mansour: "منصور", nasser: "ناصر", nasir: "ناصر", faisal: "فيصل", fahad: "فهد", zayed: "زايد", majid: "ماجد", majed: "ماجد", jamal: "جمال", kamal: "كمال",
  mustafa: "مصطفى", ismail: "إسماعيل", ismael: "إسماعيل", hamad: "حمد", hamid: "حميد", humaid: "حميد", saif: "سيف", sami: "سامي", samir: "سمير", tariq: "طارق", tarek: "طارق",
  al: "ال", el: "ال", bin: "بن", ibn: "بن", abu: "أبو", bint: "بنت", sheikh: "الشيخ", shaikh: "الشيخ",
  trading: "للتجارة", general: "العامة", contracting: "للمقاولات", contractors: "للمقاولات", construction: "للإنشاءات", building: "للبناء", materials: "مواد", electrical: "للكهرباء", electric: "للكهرباء",
  mechanical: "للميكانيكا", engineering: "للهندسة", technical: "الفنية", services: "للخدمات", service: "للخدمات", maintenance: "للصيانة", transport: "للنقل", transportation: "للنقل", shipping: "للشحن", logistics: "للخدمات اللوجستية",
  company: "شركة", co: "شركة", corporation: "مؤسسة", establishment: "مؤسسة", est: "مؤسسة", enterprises: "مؤسسة", group: "مجموعة", holding: "القابضة", international: "الدولية", gulf: "الخليج", emirates: "الإمارات",
  dubai: "دبي", sharjah: "الشارقة", ajman: "عجمان", abudhabi: "أبوظبي", fujairah: "الفجيرة", ras: "رأس", khaimah: "الخيمة", uae: "الإمارات", arab: "العرب", arabian: "العربية", middle: "الشرق", east: "الأوسط",
  llc: "ذ.م.م", fze: "م.م.ح", fzc: "م.م.ح", fzco: "م.م.ح", ltd: "المحدودة", limited: "المحدودة", inc: "ش.م", pjsc: "ش.م.ع", pvt: "الخاصة", sole: "الشخص الواحد", proprietorship: "المنشأة الفردية",
  stores: "للمواد", store: "للمتجر", supermarket: "سوبرماركت", market: "السوق", restaurant: "مطعم", cafe: "مقهى", hotel: "فندق", pharmacy: "صيدلية", clinic: "عيادة", hospital: "مستشفى", school: "مدرسة",
  motors: "للسيارات", auto: "للسيارات", cars: "للسيارات", spare: "قطع", parts: "غيار", tyres: "للإطارات", tools: "للأدوات", hardware: "للأدوات", paints: "للدهانات", steel: "للحديد", cement: "للأسمنت",
  food: "للأغذية", foods: "للأغذية", foodstuff: "للمواد الغذائية", fruits: "الفواكه", vegetables: "الخضار", fish: "الأسماك", meat: "اللحوم", computers: "للحاسبات", technology: "للتقنية", systems: "للأنظمة",
  solutions: "للحلول", software: "للبرمجيات", telecom: "للاتصالات", communications: "للاتصالات", printing: "للطباعة", press: "للطباعة", advertising: "للدعاية والإعلان", real: "العقارية", estate: "العقارات", properties: "للعقارات",
  insurance: "للتأمين", bank: "بنك", national: "الوطني", first: "الأول", new: "الجديد", modern: "الحديثة", royal: "الملكية", golden: "الذهبية", star: "النجم", sun: "الشمس", moon: "القمر", noor: "نور", nour: "نور", the: "",
};
// Letter by letter, longest group first.
const GROUPS: [string, string][] = [
  ["sh", "ش"], ["kh", "خ"], ["gh", "غ"], ["th", "ث"], ["dh", "ذ"], ["ch", "تش"], ["ph", "ف"], ["ck", "ك"], ["oo", "و"], ["ee", "ي"], ["aa", "ا"], ["ou", "و"], ["ai", "ي"], ["ei", "ي"], ["ay", "ي"], ["ey", "ي"],
  ["a", "ا"], ["b", "ب"], ["c", "ك"], ["d", "د"], ["e", ""], ["f", "ف"], ["g", "ج"], ["h", "ه"], ["i", "ي"], ["j", "ج"], ["k", "ك"], ["l", "ل"], ["m", "م"], ["n", "ن"], ["o", "و"], ["p", "ب"], ["q", "ق"],
  ["r", "ر"], ["s", "س"], ["t", "ت"], ["u", "و"], ["v", "ف"], ["w", "و"], ["x", "كس"], ["y", "ي"], ["z", "ز"],
];
function spell(word: string): string {
  let out = "";
  let i = 0;
  while (i < word.length) {
    const group = GROUPS.find(([latin]) => word.startsWith(latin, i));
    if (!group) {
      out += word[i];
      i++;
      continue;
    }
    // A vowel at the start of a word is carried by an alef.
    if (i === 0 && /^[aeiou]/.test(group[0]) && group[0].length === 1) out += group[0] === "a" || group[0] === "e" ? "ا" : group[0] === "o" || group[0] === "u" ? "و" : "إ";
    else if (i > 0 && group[0] === "e") out += "";
    else out += group[1];
    i += group[0].length;
  }
  return out;
}
/** Returns a suggested Arabic spelling of `name`, or "" when there is nothing to suggest. */
export function suggestArabic(name: string): string {
  const words = name
    .replace(/[.,]/g, " ")
    .replace(/\bal[- ]/gi, "al ")
    .split(/\s+/)
    .filter(Boolean);
  const out = words.map((raw) => {
    const w = raw.toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, "");
    if (!w) return "";
    if (/[؀-ۿ]/.test(w)) return raw;
    if (/^\d+$/.test(w)) return w;
    if (Object.hasOwn(WORDS, w)) return WORDS[w];
    return spell(w);
  });
  // "al" joins to the word after it (النور), so the Arabic article is written without a space.
  const joined: string[] = [];
  for (let i = 0; i < out.length; i++) {
    if (out[i] === "ال" && i + 1 < out.length && out[i + 1]) {
      joined.push("ال" + out[i + 1]);
      i++;
    } else if (out[i]) joined.push(out[i]);
  }
  // "Company" and "Establishment" come first in an Arabic business name.
  const first = joined.filter((w) => w === "شركة" || w === "مؤسسة");
  return [...first, ...joined.filter((w) => w !== "شركة" && w !== "مؤسسة")].join(" ").trim();
}
