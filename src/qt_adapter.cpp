// Optional Qt-only ABI module. No Qt dependency in the Nicotine executable.
// This prototype exposes an image surface and input, not a widget abstraction.
#include <QApplication>
#include <QImage>
#include <QKeyEvent>
#include <QMouseEvent>
#include <QPainter>
#include <QTimer>
#include <QWidget>
#include <QSettings>
#include <QStandardPaths>
#include <QDir>
#include <QMoveEvent>
#include <QResizeEvent>
#include <cstdlib>
using Draw = void (*)(void *,int,int,int);
using Click = void (*)(double,double);
using Key = void (*)(int);
using Tick = void (*)();
static QString clockSettingsPath() {
    const QString directory=QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation)+"/nicotine";
    QDir().mkpath(directory);return directory+"/clock-qt.ini";
}
class Surface final : public QWidget {
    Draw draw; Click click; Key key;
    QTimer saveTimer;
    QString settingsPath;
public:
    Surface(Draw d,Click c,Key k,Tick tick):draw(d),click(c),key(k) {
        setWindowTitle("Clock — Nicotine / Qt"); resize(360,360);
        setMinimumSize(180,180);setFocusPolicy(Qt::StrongFocus);
        settingsPath=clockSettingsPath();
        QSettings settings(settingsPath,QSettings::IniFormat);
        setWindowFlag(Qt::WindowStaysOnTopHint,settings.value("window/always_on_top",false).toBool());
        restoreGeometry(settings.value("window/geometry").toByteArray());
        saveTimer.setSingleShot(true);saveTimer.setInterval(250);
        connect(&saveTimer,&QTimer::timeout,this,[this]{saveWindowGeometry();});
        setAccessibleName("Analog clock and stopwatch. Space starts or splits; R resets.");
        auto timer=new QTimer(this);
        connect(timer,&QTimer::timeout,this,[this,tick]{tick();update();});timer->start(33);
    }
    void saveWindowGeometry() {
        QSettings settings(settingsPath,QSettings::IniFormat);
        settings.setValue("window/geometry",saveGeometry());settings.sync();
    }
    void setTopmost(bool enabled) {
        const QRect previous=geometry();const bool visible=isVisible();
        setWindowFlag(Qt::WindowStaysOnTopHint,enabled);setGeometry(previous);
        if(visible)show();
        QSettings settings(settingsPath,QSettings::IniFormat);
        settings.setValue("window/always_on_top",enabled);settings.sync();
    }
    void moveEvent(QMoveEvent *event) override {
        QWidget::moveEvent(event);if(isVisible())saveTimer.start();
    }
    void resizeEvent(QResizeEvent *event) override {
        QWidget::resizeEvent(event);if(isVisible())saveTimer.start();
    }
    void paintEvent(QPaintEvent *) override {
        // Device-independent rendering; QPainter handles the display scale.
        QImage image(width(),height(),QImage::Format_ARGB32_Premultiplied);
        image.fill(Qt::transparent);draw(image.bits(),image.width(),image.height(),image.bytesPerLine());
        QPainter painter(this);painter.drawImage(0,0,image);
    }
    void mousePressEvent(QMouseEvent *event) override {
        if(event->button()==Qt::LeftButton)click(event->position().x(),event->position().y());
        update();
    }
    void keyPressEvent(QKeyEvent *event) override {
        int value=event->key();
        if(value==Qt::Key_Escape)value=27;
        else if(value==Qt::Key_Return || value==Qt::Key_Enter)value=13;
        key(value);update();
    }
};
static Surface *surface=nullptr;
extern "C" int nicotine_qt_run(Draw draw,Click click,Key key,Tick tick) {
    int argc=1;char name[]="nicotine-clock";char *argv[]={name,nullptr};
    QApplication app(argc,argv);
    Surface window(draw,click,key,tick);surface=&window;window.show();
    const int result=app.exec();window.saveWindowGeometry();surface=nullptr;return result;
}
extern "C" void nicotine_qt_quit() {QApplication::quit();}
extern "C" int nicotine_qt_get_topmost() {
    QSettings settings(clockSettingsPath(),QSettings::IniFormat);
    return settings.value("window/always_on_top",false).toBool();
}
extern "C" void nicotine_qt_set_topmost(int enabled) {if(surface)surface->setTopmost(enabled!=0);}
