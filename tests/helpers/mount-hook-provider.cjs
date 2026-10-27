const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
module.exports=function mountProvider(file,exportName,modules,globals={}){
  const slots=[],effects=[],pending=[];let cursor=0;
  const hooks={createContext:()=>({Provider:'Provider'}),useContext(){throw Error('Not used')},
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]},
    useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i]},
    useEffect(fn,deps){const i=cursor++,old=effects[i];if(!old||deps.some((d,p)=>d!==old.deps[p]))pending.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn()}})}
  };
  const filename=path.resolve(file);const output=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},fileName:filename}).outputText;
  const module={exports:{}};
  const all={react:hooks,'react/jsx-runtime':{jsx:(type,props)=>({type,props})},...modules};
  vm.runInNewContext(output,{module,exports:module.exports,require:name=>{if(!(name in all))throw Error('Unexpected dependency '+name);return all[name]},console,...globals},{filename});
  function value(){cursor=0;const result=module.exports[exportName]({children:null});while(pending.length)pending.shift()();return result.props.value}
  value();return{value,dispose(){for(const e of effects)e?.cleanup?.()}};
};
