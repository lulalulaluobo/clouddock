function r(o,e){let t=0;return function(...i){const n=Date.now();n-t>=e&&(o.apply(this,i),t=n)}}export{r as t};
