#include <stdint.h>
#include <stddef.h>
uint64_t echo_u64(uint64_t n){return n;}
double add_double(double a,double b){return a+b;}
void write_u32(uint32_t *p,uint32_t n){*p=n;}
int call_callback(int (*callback)(int),int n){return callback(n);}
int fixture_abi(void){return 1;}
