// js/core/input.js
export class Input{
  constructor(){
    this.keysDown = new Set();
    this.lastKey = null;

    window.addEventListener("keydown", (e)=>{
      this.keysDown.add(e.key);
      this.lastKey = e.key;

      // Prevent page scroll by arrows/space
      if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key)){
        e.preventDefault();
      }
    }, {passive:false});

    window.addEventListener("keyup", (e)=>{
      this.keysDown.delete(e.key);
    });
  }

  consumeLastKey(){
    const k = this.lastKey;
    this.lastKey = null;
    return k;
  }

  isDown(key){
    return this.keysDown.has(key);
  }
}
