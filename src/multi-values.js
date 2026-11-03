export function resolveMultiValue(value, options) {
  const input = value.trim();
  if (!input || input.length > 10000 || !Array.isArray(options) || options.length > 2000) return {reason:'多选文字或选项列表无效'};
  const names = [...new Set(options.map(option=>option.text).filter(name=>typeof name==='string' && name.trim()))];
  const queue = [{offset:0, values:[]}], solutions = [];
  let attempts = 0;
  for (let index=0; index<queue.length; index++) {
    const state = queue[index];
    for (const name of names) {
      if (++attempts > 100000) return {reason:'多选拆分候选过多，请逐项核对'};
      if (!input.startsWith(name,state.offset) || state.values.includes(name)) continue;
      let next = state.offset + name.length;
      const values = [...state.values,name];
      if (values.length > 200) continue;
      if (next === input.length) {
        solutions.push(values);
        if (solutions.length > 1) return {reason:'多选文字有多种完整选项组合，请核对'};
      } else {
        if (!/\s/.test(input[next])) continue;
        while (next<input.length && /\s/.test(input[next])) next++;
        // Paths at the same offset can have different previously selected values.
        queue.push({offset:next,values});
      }
    }
  }
  return solutions.length === 1 ? {values:solutions[0]} : {reason:'无法将多选文字逐项匹配到完整同名选项'};
}
