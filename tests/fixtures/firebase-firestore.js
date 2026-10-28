const fake = () => globalThis.__fakeFirebase;
const clone = value => structuredClone(value);
const deleted = value => value && value.__fakeDelete === true;
function merge(target, update) {
  for (const [key, value] of Object.entries(update)) {
    if (deleted(value)) delete target[key];
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      if (!Object.keys(value).length) target[key] = {};
      else target[key] = merge(target[key] && typeof target[key] === "object" ? target[key] : {}, value);
    } else target[key] = value;
  }
  return target;
}
function apply(docs, operation) {
  const {type, ref, data, options} = operation;
  if (type === "delete") delete docs[ref.path];
  else if (type === "update") {
    if (!docs[ref.path]) throw Object.assign(new Error("missing document"), {code: "not-found"});
    docs[ref.path] = merge(docs[ref.path], data);
  } else docs[ref.path] = options && options.merge ? merge(docs[ref.path] || {}, data) : clone(data);
}
function docSnapshot(path) {
  const data = fake().docs[path], ref = {path, id: path.split("/").pop()};
  return {id: ref.id, ref, exists: () => !!data, data: () => clone(data)};
}
function check(operations) {
  if (fake().failPath && operations.some(operation => operation.ref.path === fake().failPath)) throw Object.assign(new Error("denied"), {code: "permission-denied"});
}
export function getFirestore() { return {}; }
export function collection(_, name) { return {path: name}; }
export function doc(_, name, id) { return {path: `${name}/${id}`, id}; }
export function where(field, op, value) { return {field, op, value}; }
export function query(ref, filter) { return {...ref, filter}; }
export async function getDoc(ref) { return docSnapshot(ref.path); }
export async function getDocs(ref) {
  const prefix = `${ref.path}/`;
  const docs = Object.keys(fake().docs).filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
    .map(docSnapshot).filter(item => !ref.filter || item.data()[ref.filter.field] === ref.filter.value);
  return {docs, empty: !docs.length};
}
export async function setDoc(ref, data, options) { const operation = {type: "set", ref, data, options}; check([operation]); apply(fake().docs, operation); }
export function deleteField() { return {__fakeDelete: true}; }
export function increment(value) { return value; }
export function writeBatch() {
  const operations = [];
  return {
    set: (ref, data, options) => operations.push({type: "set", ref, data, options}),
    update: (ref, data) => operations.push({type: "update", ref, data}),
    delete: ref => operations.push({type: "delete", ref}),
    async commit() { check(operations); const docs = clone(fake().docs); operations.forEach(operation => apply(docs, operation)); fake().docs = docs; fake().commits++; }
  };
}
