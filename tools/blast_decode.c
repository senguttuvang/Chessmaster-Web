#include "blast.h"
#include <string.h>
typedef struct { unsigned char *p; unsigned n; } Input;
typedef struct { unsigned char *p; unsigned used,cap; } Output;
static unsigned input(void *ctx,unsigned char **p) { Input *i=ctx;*p=i->p;unsigned n=i->n;i->n=0;return n; }
static int output(void *ctx,unsigned char *p,unsigned n) { Output *o=ctx;if(n>o->cap-o->used)return 1;memcpy(o->p+o->used,p,n);o->used+=n;return 0; }
int blast_decode(unsigned char *src,unsigned len,unsigned char *dst,unsigned cap) {
    Input i={src,len};Output o={dst,0,cap};int result=blast(input,&i,output,&o,0,0);return result?-1000+result:(int)o.used;
}
