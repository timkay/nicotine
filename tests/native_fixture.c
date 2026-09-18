#include <stdint.h>
#include <stddef.h>
uint64_t echo_u64(uint64_t n){return n;}
double add_double(double a,double b){return a+b;}
void write_u32(uint32_t *p,uint32_t n){*p=n;}
int call_callback(int (*callback)(int),int n){return callback(n);}
int fixture_abi(void){return 1;}

typedef struct { double x, y; } Point;
typedef struct { Point origin, size; } Rectangle;
Point offset_point(Point point, double amount) {
    return (Point){point.x + amount, point.y - amount};
}
double rectangle_area(Rectangle rectangle) {
    return rectangle.size.x * rectangle.size.y;
}
Point call_point_callback(Point (*callback)(Point), Point point) {
    return callback(point);
}
typedef struct { uint8_t tag; double value; } Tagged;
Tagged update_tagged(Tagged value) {
    value.tag++;
    value.value *= 2;
    return value;
}
int8_t echo_i8(int8_t value) { return value; }
uint8_t echo_u8(uint8_t value) { return value; }
