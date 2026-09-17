#include "clock_ui.h"
#include <gtk/gtk.h>
static GtkWidget *window,*labels[3];
static ClockAction action;
static ClockTick tick;
static void clicked(GtkButton *button,gpointer value){(void)button;action(GPOINTER_TO_INT(value));}
static void destroyed(GtkWidget *widget,gpointer data){(void)widget;(void)data;window=NULL;gtk_main_quit();}
static gboolean refresh(gpointer unused){(void)unused;tick();return G_SOURCE_CONTINUE;}
void nicotine_clock_update(const char *time,const char *date,const char *elapsed){
    if(!window)return;
    const char *text[]={time,date,elapsed};
    for(int i=0;i<3;i++)gtk_label_set_text(GTK_LABEL(labels[i]),text[i]);
}
void nicotine_clock_quit(void){if(window)gtk_widget_destroy(window);}
int nicotine_clock_run(ClockAction on_action,ClockTick on_tick){
    if(window || !on_action || !on_tick || !gtk_init_check(NULL,NULL))return 1;
    action=on_action;tick=on_tick;
    window=gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(window),"Nicotine Clock — GTK");
    gtk_window_set_default_size(GTK_WINDOW(window),420,220);
    GtkWidget *box=gtk_box_new(GTK_ORIENTATION_VERTICAL,12);
    gtk_container_set_border_width(GTK_CONTAINER(box),24);gtk_container_add(GTK_CONTAINER(window),box);
    for(int i=0;i<3;i++){labels[i]=gtk_label_new("");gtk_box_pack_start(GTK_BOX(box),labels[i],TRUE,TRUE,0);}
    GtkWidget *buttons=gtk_box_new(GTK_ORIENTATION_HORIZONTAL,12);
    gtk_box_pack_start(GTK_BOX(box),buttons,FALSE,FALSE,0);
    const char *titles[]={"Start / split","Reset"};
    for(int i=0;i<2;i++){
        GtkWidget *button=gtk_button_new_with_label(titles[i]);
        gtk_box_pack_start(GTK_BOX(buttons),button,TRUE,TRUE,0);
        g_signal_connect(button,"clicked",G_CALLBACK(clicked),GINT_TO_POINTER(i+1));
    }
    g_signal_connect(window,"destroy",G_CALLBACK(destroyed),NULL);
    guint timer=g_timeout_add(33,refresh,NULL);
    gtk_widget_show_all(window);gtk_main();g_source_remove(timer);
    return 0;
}
