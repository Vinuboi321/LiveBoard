import type { Slide } from './data';

export type SampleMarker = {
  id:string; slide:number; x:number; y:number; kind:'question';
  author:string; body:string; response:string; resolved:number; created:number;
};

export type Presentation = {
  id: string;
  title: string;
  slides: Slide[];
  className: string;
  unit: string;
  topic: string;
  updated: number;
  sampleMarkers?: SampleMarker[];
};

function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open('liveboard-presentations',1);
    request.onupgradeneeded = () => request.result.createObjectStore('decks',{keyPath:'id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function access<T>(mode:IDBTransactionMode, operation:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T> {
  const db=await openLibrary();
  try {
    return await new Promise((resolve,reject) => {
      const transaction=db.transaction('decks',mode);
      const request=operation(transaction.objectStore('decks'));
      transaction.oncomplete=()=>resolve(request.result);
      transaction.onabort=()=>reject(transaction.error);
      transaction.onerror=()=>reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export const listPresentations=()=>access<Presentation[]>('readonly',store=>store.getAll());
export const getPresentation=(id:string)=>access<Presentation|undefined>('readonly',store=>store.get(id));
export const savePresentation=(deck:Presentation)=>access('readwrite',store=>store.put(deck));
export const deletePresentation=(id:string)=>access('readwrite',store=>store.delete(id));
