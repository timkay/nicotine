#include "clock_ui.h"
#include <QApplication>
#include <QLabel>
#include <QPushButton>
#include <QTimer>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QWidget>
static QWidget *window;
static QLabel *labels[3];
void nicotine_clock_update(const char *time,const char *date,const char *elapsed){
    if(!window)return;
    const char *text[]={time,date,elapsed};
    for(int i=0;i<3;i++)labels[i]->setText(QString::fromUtf8(text[i]));
}
void nicotine_clock_quit(){if(window)window->close();}
int nicotine_clock_run(ClockAction action,ClockTick tick){
    if(window || !action || !tick)return 1;
    int argc=1;char name[]="nicotine-clock";char *argv[]={name,nullptr};QApplication app(argc,argv);
    QWidget widget;window=&widget;widget.setWindowTitle("Nicotine Clock — Qt");widget.resize(420,220);
    auto layout=new QVBoxLayout(&widget);
    for(int i=0;i<3;i++){
        labels[i]=new QLabel;labels[i]->setTextFormat(Qt::PlainText);
        labels[i]->setAlignment(Qt::AlignCenter);layout->addWidget(labels[i]);
    }
    auto buttons=new QHBoxLayout;layout->addLayout(buttons);
    const char *titles[]={"Start / split","Reset"};
    for(int i=0;i<2;i++){
        auto button=new QPushButton(titles[i]);buttons->addWidget(button);
        QObject::connect(button,&QPushButton::clicked,[action,i]{action(i+1);});
    }
    QTimer timer;QObject::connect(&timer,&QTimer::timeout,[tick]{tick();});timer.start(33);
    widget.show();int result=app.exec();window=nullptr;return result;
}
